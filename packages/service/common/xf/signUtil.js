import UUID from 'uuid-js';
import md5 from 'js-md5';

export function sign(method, params) {
  const { XF_SIGN_MD5SECRET } = process.env;

  let timestamp = new Date().getTime() + '';
  let nonceStr = UUID.create().toString();
  let signstr;

  if (method.toUpperCase() === 'GET') {
    if (params) {
      signstr =
        tansParamsNoencodeURI(params) +
        'timestamp=' +
        timestamp +
        '&nonceStr=' +
        nonceStr +
        '&key=' +
        XF_SIGN_MD5SECRET;
    } else {
      signstr = 'timestamp=' + timestamp + '&nonceStr=' + nonceStr + '&key=' + XF_SIGN_MD5SECRET;
    }
  }

  if (method.toUpperCase() === 'POST') {
    params = typeof params === 'object' ? JSON.stringify(params) : params;
    signstr = params + '&timestamp=' + timestamp + '&nonceStr=' + nonceStr + '&key=' + XF_SIGN_MD5SECRET;
  }

  return {
    signature: md5(signstr),
    timestamp,
    nonceStr
  };
}


/**
 * 参数处理
 * @param {*} params  参数
 */
export function tansParamsNoencodeURI(params) {
  let result = '';
  for (const propName of Object.keys(params).sort()) {
    const value = params[propName];
    var part = propName + '=';
    if (value !== null && typeof value !== 'undefined') {
      if (typeof value === 'object') {
        for (const key of Object.keys(value)) {
          if (value[key] !== null && typeof value[key] !== 'undefined') {
            let params = propName + '[' + key + ']';
            var subPart = params + '=';
            result += subPart + value[key] + '&';
          }
        }
      } else {
        result += part + value + '&';
      }
    }
  }
  return result;
}
