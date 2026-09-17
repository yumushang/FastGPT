import { GET, PUT, POST, DELETE } from '@/web/common/api/request';
import type {
  GetPkgPluginUploadURLQueryType,
  GetPkgPluginUploadURLResponseType,
  UploadPkgPluginResponseType,
  ParseUploadedPkgPluginQueryType,
  ParseUploadedPkgPluginResponseType,
  ConfirmUploadPkgPluginBodyType,
  DeletePkgPluginQueryType,
  InstallPluginFromUrlBodyType
} from '@fastgpt/global/openapi/core/plugin/admin/api';

// Pkg plugin
export const getPkgPluginUploadURL = (params: GetPkgPluginUploadURLQueryType) =>
  GET<GetPkgPluginUploadURLResponseType>(`/core/plugin/admin/pkg/presign`, params);

export const uploadPkgPluginFile = ({ filename, file }: { filename: string; file: File }) =>
  PUT<UploadPkgPluginResponseType>(
    `/core/plugin/admin/pkg/upload?filename=${encodeURIComponent(filename)}`,
    file,
    { timeout: 5 * 60 * 1000 }
  );

export const parseUploadedPkgPlugin = (params: ParseUploadedPkgPluginQueryType) =>
  GET<ParseUploadedPkgPluginResponseType>(`/core/plugin/admin/pkg/parse`, params);

export const confirmPkgPluginUpload = (data: ConfirmUploadPkgPluginBodyType) =>
  POST(`/core/plugin/admin/pkg/confirm`, data);

export const deletePkgPlugin = (data: DeletePkgPluginQueryType) =>
  DELETE('/core/plugin/admin/pkg/delete', data);

export const intallPluginWithUrl = (data: InstallPluginFromUrlBodyType) =>
  POST('/core/plugin/admin/installWithUrl', data);
