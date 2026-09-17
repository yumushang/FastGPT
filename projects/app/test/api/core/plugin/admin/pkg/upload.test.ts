import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';
import { Readable } from 'node:stream';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

// --- MOCKS ---

vi.mock('@fastgpt/service/support/permission/user/auth', () => ({
  authSystemAdmin: vi.fn().mockResolvedValue(undefined)
}));

vi.mock('@fastgpt/service/thirdProvider/fastgptPlugin', () => ({
  pluginClient: {
    getToolUploadUrl: vi.fn()
  }
}));

import { handler } from '@/pages/api/core/plugin/admin/pkg/upload';
import { authSystemAdmin } from '@fastgpt/service/support/permission/user/auth';
import { pluginClient } from '@fastgpt/service/thirdProvider/fastgptPlugin';

// --- Fake storage server (stands in for MinIO) ---

type ReceivedUpload = {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
};

let server: Server;
let storageUrl: string;
let lastUpload: ReceivedUpload | undefined;
let respondWithError = false;

beforeAll(async () => {
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      lastUpload = { method: req.method, headers: req.headers, body: Buffer.concat(chunks) };
      if (respondWithError) {
        res.writeHead(500).end('storage error');
        return;
      }
      res.writeHead(200).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  storageUrl = `http://127.0.0.1:${port}/fastgpt-private/system/plugin/tools/fake-object?X-Amz-Signature=fake`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  vi.clearAllMocks();
  lastUpload = undefined;
  respondWithError = false;
  vi.mocked(pluginClient.getToolUploadUrl).mockResolvedValue({
    postURL: storageUrl,
    formData: {
      'x-amz-meta-original-filename': 'test.pkg',
      'x-amz-meta-upload-time': '2026-09-17'
    },
    objectName: 'system/plugin/tools/fake-object'
  });
});

const buildReq = ({
  method = 'PUT',
  query = { filename: 'test.pkg' },
  body = Buffer.from('fake-pkg-binary-content'),
  contentLength
}: {
  method?: string;
  query?: Record<string, string>;
  body?: Buffer;
  contentLength?: string;
}): NextApiRequest => {
  const stream = Readable.from([body]);
  const req = stream as unknown as NextApiRequest;
  req.method = method;
  req.query = query;
  req.headers = {
    'content-length': contentLength ?? String(body.length)
  };
  return req;
};

const res = {} as NextApiResponse;

describe('handler (pkg upload relay)', () => {
  it('rejects non-PUT methods', async () => {
    await expect(handler(buildReq({ method: 'POST' }), res)).rejects.toBe('Method not allowed');
    expect(authSystemAdmin).not.toHaveBeenCalled();
  });

  it('rejects when filename is missing', async () => {
    await expect(handler(buildReq({ query: {} }), res)).rejects.toBe('Filename is required');
  });

  it('propagates auth failure', async () => {
    vi.mocked(authSystemAdmin).mockRejectedValueOnce(new Error('unAuthorization'));
    await expect(handler(buildReq({}), res)).rejects.toThrow('unAuthorization');
    expect(pluginClient.getToolUploadUrl).not.toHaveBeenCalled();
  });

  it('streams the request body to the storage presigned URL and returns objectName', async () => {
    const payload = Buffer.alloc(1024 * 1024, 'a'); // 1MB
    const req = buildReq({ body: payload });

    const result = await handler(req, res);

    expect(result).toEqual({ objectName: 'system/plugin/tools/fake-object' });
    expect(pluginClient.getToolUploadUrl).toHaveBeenCalledWith('test.pkg');
    expect(lastUpload?.method).toBe('PUT');
    expect(lastUpload?.body.equals(payload)).toBe(true);
    // formData headers are forwarded
    expect(lastUpload?.headers['x-amz-meta-original-filename']).toBe('test.pkg');
    expect(lastUpload?.headers['x-amz-meta-upload-time']).toBe('2026-09-17');
    // content-length is passed through
    expect(lastUpload?.headers['content-length']).toBe(String(payload.length));
  });

  it('rejects when the storage upload fails', async () => {
    respondWithError = true;
    await expect(handler(buildReq({}), res)).rejects.toBe('Upload pkg plugin to storage failed');
  });
});
