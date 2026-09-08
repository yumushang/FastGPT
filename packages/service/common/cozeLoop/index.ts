import { cozeLoopTracer } from '@cozeloop/ai';

let _initialized = false;

/**
 * 安全地获取 CozeLoop Tracer 实例
 * - 仅在服务端调用
 * - 自动初始化（仅一次）
 */
export function getCozeTracer() {
  // 防止重复初始化
  if (!_initialized) {
    const { COZELOOP_ENABLE, COZELOOP_WORKSPACE_ID, COZELOOP_API_BASE_URL, COZELOOP_API_TOKEN } =
      process.env;

    // 必须全部存在才初始化
    if (
      COZELOOP_ENABLE === 'true' &&
      COZELOOP_WORKSPACE_ID &&
      COZELOOP_API_TOKEN &&
      COZELOOP_API_BASE_URL
    ) {
      cozeLoopTracer.initialize({
        workspaceId: COZELOOP_WORKSPACE_ID,
        apiClient: {
          baseURL: COZELOOP_API_BASE_URL,
          token: COZELOOP_API_TOKEN
        },
        ultraLargeReport: true
      });
      _initialized = true;
      console.log('✅ CozeLoop tracer initialized');
    } else {
      console.warn('⚠️ CozeLoop tracer not initialized: missing required env vars');
    }
  }

  return cozeLoopTracer;
}
