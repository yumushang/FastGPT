import type { NextApiRequest, NextApiResponse } from 'next';
import axios from 'axios';
import { NextAPI } from '@/service/middleware/entry';
import { authSystemAdmin } from '@fastgpt/service/support/permission/user/auth';
import { pluginClient } from '@fastgpt/service/thirdProvider/fastgptPlugin';
import type {
  UploadPkgPluginQueryType,
  UploadPkgPluginResponseType
} from '@fastgpt/global/openapi/core/plugin/admin/api';

/*
  Relay upload: receive the pkg file from the client and stream it to the storage
  service with a server-side presigned URL, so the client never connects to the
  file server directly.
*/
export async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<UploadPkgPluginResponseType> {
  if (req.method !== 'PUT') {
    return Promise.reject('Method not allowed');
  }
  await authSystemAdmin({ req });

  const { filename } = req.query as UploadPkgPluginQueryType;
  if (!filename) {
    return Promise.reject('Filename is required');
  }

  const { postURL, formData, objectName } = await pluginClient.getToolUploadUrl(filename);

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(formData || {})) {
    headers[key] = String(value);
  }
  const contentLength = req.headers['content-length'];
  if (contentLength) {
    headers['content-length'] = Array.isArray(contentLength) ? contentLength[0] : contentLength;
  }

  try {
    await axios.put(postURL, req, {
      headers,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 0
    });
  } catch (error) {
    return Promise.reject('Upload pkg plugin to storage failed');
  }

  return { objectName };
}

export default NextAPI(handler);

export const config = {
  api: {
    bodyParser: false,
    responseLimit: false
  }
};
