use axum::extract::ws::Message as AxumMsg;
use serde_json::Value;
use tokio_tungstenite::tungstenite::Message as WsMsg;

/// 校验 Workspace 相对路径是否处于凭证授权根目录内，拒绝非规范路径和目录穿越。
pub fn is_path_within_root(path: &str, root: &str) -> bool {
    if path.is_empty() || path.starts_with('/') || path.contains('\\') || path.contains('\0') {
        return false;
    }

    let normalized = path.strip_prefix("./").unwrap_or(path);
    if normalized.split('/').any(|segment| {
        segment.is_empty()
            || segment == "."
            || segment == ".."
            || segment.chars().any(char::is_control)
    }) && normalized != "."
    {
        return false;
    }

    root == "." || normalized == root || normalized.starts_with(&format!("{root}/"))
}

/// 普通 App 的 FS 连接只能操作当前 Session；无法静态约束目录的 fs/exec 直接拒绝。
pub fn client_message_allowed(message: &AxumMsg, allowed_root: Option<&str>) -> bool {
    let Some(root) = allowed_root.filter(|root| *root != ".") else {
        return true;
    };
    let payload = match message {
        AxumMsg::Text(text) => text.as_str(),
        AxumMsg::Binary(bytes) => {
            let Ok(text) = std::str::from_utf8(bytes) else {
                return false;
            };
            text
        }
        _ => return true,
    };
    let Ok(request) = serde_json::from_str::<Value>(payload) else {
        return true;
    };
    let Some(method) = request.get("method").and_then(Value::as_str) else {
        return true;
    };
    if method == "fs/exec" {
        return false;
    }

    let params = request.get("params");
    ["path", "from", "to"].into_iter().all(|key| {
        params
            .and_then(|params| params.get(key))
            .and_then(Value::as_str)
            .is_none_or(|path| is_path_within_root(path, root))
    })
}

/// 过滤共享 Workspace 的文件监听通知，避免向其他 Session 泄露文件路径。
pub fn scope_upstream_message(message: WsMsg, allowed_root: Option<&str>) -> Option<WsMsg> {
    let Some(root) = allowed_root.filter(|root| *root != ".") else {
        return Some(message);
    };
    let WsMsg::Text(text) = message else {
        return Some(message);
    };
    let original = text.as_str();
    let Ok(mut notification) = serde_json::from_str::<Value>(original) else {
        return Some(WsMsg::Text(text));
    };
    if notification.get("method").and_then(Value::as_str) != Some("fs/did_change") {
        return Some(WsMsg::Text(text));
    }

    let overflow = notification
        .pointer("/params/overflow")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let paths = notification
        .pointer_mut("/params/paths")
        .and_then(Value::as_array_mut);
    let Some(paths) = paths else {
        return None;
    };
    paths.retain(|path| {
        path.as_str()
            .is_some_and(|path| is_path_within_root(path, root))
    });
    if paths.is_empty() && !overflow {
        return None;
    }

    serde_json::to_string(&notification)
        .ok()
        .map(|text| WsMsg::Text(text.into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_canonical_paths_against_session_root() {
        assert!(is_path_within_root("sessions/chat-1", "sessions/chat-1"));
        assert!(is_path_within_root(
            "sessions/chat-1/a.txt",
            "sessions/chat-1"
        ));
        assert!(is_path_within_root("sessions/chat-2/a.txt", "."));
        assert!(!is_path_within_root(
            "sessions/chat-2/a.txt",
            "sessions/chat-1"
        ));
        assert!(!is_path_within_root(
            "sessions/chat-1/../chat-2/a.txt",
            "sessions/chat-1"
        ));
        assert!(!is_path_within_root("/etc/passwd", "sessions/chat-1"));
    }

    #[test]
    fn validates_fs_request_paths_and_rejects_scoped_exec() {
        let allowed = AxumMsg::Text(
            r#"{"method":"fs/read_file","params":{"path":"sessions/chat-1/a.txt"}}"#.into(),
        );
        let rejected = AxumMsg::Text(
            r#"{"method":"fs/delete","params":{"path":"sessions/chat-2/a.txt"}}"#.into(),
        );
        let exec = AxumMsg::Text(r#"{"method":"fs/exec","params":{"command":"pwd"}}"#.into());

        assert!(client_message_allowed(&allowed, Some("sessions/chat-1")));
        assert!(!client_message_allowed(&rejected, Some("sessions/chat-1")));
        assert!(!client_message_allowed(&exec, Some("sessions/chat-1")));
        assert!(client_message_allowed(&exec, Some(".")));
    }

    #[test]
    fn filters_change_notifications_to_the_current_session() {
        let message = WsMsg::Text(
            r#"{"jsonrpc":"2.0","method":"fs/did_change","params":{"paths":["sessions/chat-1/a.txt","sessions/chat-2/b.txt"],"overflow":false}}"#.into(),
        );
        let scoped = scope_upstream_message(message, Some("sessions/chat-1")).unwrap();
        let WsMsg::Text(text) = scoped else {
            panic!("expected text notification");
        };
        let value: Value = serde_json::from_str(text.as_str()).unwrap();
        assert_eq!(
            value
                .pointer("/params/paths")
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
    }
}
