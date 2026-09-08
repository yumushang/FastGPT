import MyModal from '@fastgpt/web/components/common/MyModal';
import React from 'react';
import { useTranslation } from 'next-i18next';
import { Button, ModalBody, ModalFooter, Textarea } from '@chakra-ui/react';
import { useForm } from 'react-hook-form';
import { useToast } from '@fastgpt/web/hooks/useToast';
import { type HttpMethod, ContentTypes } from '@fastgpt/global/core/workflow/constants';
import type { ParamItemType } from './ManualToolModal';
import type { StoreSecretValueType } from '@fastgpt/global/common/secret/type';

export type OpenApiImportResult = {
  name: string;
  description: string;
  method: HttpMethod;
  path: string;
  params?: ParamItemType[];
  headers?: ParamItemType[];
  bodyType: string;
  bodyContent?: string;
  bodyFormData?: ParamItemType[];
  headerSecret?: StoreSecretValueType;
  customParams: {
    key: string;
    description: string;
    type: string;
    required: boolean;
    isTool: boolean;
  }[];
};

type OpenApiImportModalProps = {
  onClose: () => void;
  onImport: (result: OpenApiImportResult) => void;
};

// OpenAPI 2.0 (Swagger) parameter type mapping
const openApiTypeMap: Record<string, string> = {
  string: 'string',
  integer: 'number',
  number: 'number',
  boolean: 'boolean',
  array: 'array',
  object: 'object'
};

// Helper function to resolve $ref in schema
const resolveRef = (schema: any, definitions: any): any => {
  if (!schema) return null;

  if (schema.$ref) {
    const refPath = schema.$ref.replace('#/definitions/', '');
    return definitions?.[refPath] || null;
  }

  if (schema.originalRef && definitions?.[schema.originalRef]) {
    return definitions[schema.originalRef];
  }

  return schema;
};

// Helper function to generate body content from schema
const generateBodyContent = (schema: any, definitions: any): any => {
  const resolvedSchema = resolveRef(schema, definitions);
  if (!resolvedSchema) return {};

  const result: any = {};

  if (resolvedSchema.properties) {
    Object.entries(resolvedSchema.properties).forEach(([key, value]: [string, any]) => {
      // Skip read-only properties
      if (value.readOnly) return;

      // Get the type
      const type = value.type || 'string';

      // Generate example value based on type
      switch (type) {
        case 'string':
          result[key] = value.description ? `<${value.description}>` : `<${key}>`;
          break;
        case 'integer':
        case 'number':
          result[key] = 0;
          break;
        case 'boolean':
          result[key] = false;
          break;
        case 'array':
          result[key] = [];
          break;
        case 'object':
          result[key] = generateBodyContent(value, definitions);
          break;
        default:
          result[key] = null;
      }
    });
  }

  return result;
};

const OpenApiImportModal = ({ onClose, onImport }: OpenApiImportModalProps) => {
  const { t } = useTranslation();
  const { toast } = useToast();

  const { register, handleSubmit } = useForm({
    defaultValues: {
      openApiContent: ''
    }
  });

  const handleOpenApiImport = (data: { openApiContent: string }) => {
    try {
      const parsed = JSON.parse(data.openApiContent);

      // Get definitions for resolving $ref
      const definitions = parsed.definitions || {};

      // Get host and basePath
      const host = parsed.host || '';
      const basePath = parsed.basePath || '';
      const schemes = parsed.schemes || ['http'];
      const protocol = schemes[0] || 'http';

      // Get the first path
      const paths = parsed.paths || {};
      const pathKeys = Object.keys(paths);

      if (pathKeys.length === 0) {
        throw new Error('No paths found in OpenAPI schema');
      }

      const firstPath = pathKeys[0];
      const pathItem = paths[firstPath];

      // Get the first method (get, post, put, delete, etc.)
      const methodKeys = Object.keys(pathItem);
      const validMethods = ['get', 'post', 'put', 'delete', 'patch'];
      const method = methodKeys.find((m) => validMethods.includes(m.toLowerCase()));

      if (!method) {
        throw new Error('No valid HTTP method found in OpenAPI schema');
      }

      const operation = pathItem[method];

      // Build URL
      let url = '';
      if (host) {
        url = `${protocol}://${host}${basePath}${firstPath}`;
      } else {
        url = `${basePath}${firstPath}`;
      }

      // Parse parameters
      const parameters = operation.parameters || [];
      const queryParams: ParamItemType[] = [];
      const headers: ParamItemType[] = [];
      const customParams: {
        key: string;
        description: string;
        type: string;
        required: boolean;
        isTool: boolean;
      }[] = [];

      let headerSecret: StoreSecretValueType | undefined;
      let bodyContent = '';

      parameters.forEach((param: any) => {
        const paramIn = param.in || 'query';
        const paramName = param.name || '';
        const paramRequired = param.required || false;
        const paramType = openApiTypeMap[param.type] || 'string';
        const paramDesc = param.description || '';

        if (paramIn === 'query' || paramIn === 'path') {
          // Query parameters go to static params
          queryParams.push({
            key: paramName,
            value: ''
          });

          // Also add to custom params for tool input
          customParams.push({
            key: paramName,
            description: paramDesc,
            type: paramType,
            required: paramRequired,
            isTool: true
          });
        } else if (paramIn === 'header') {
          // Handle Authorization header
          if (paramName.toLowerCase() === 'authorization') {
            // Skip adding to headers, will be handled separately if needed
            return;
          }
          headers.push({
            key: paramName,
            value: ''
          });
        } else if (paramIn === 'body' || paramIn === 'formData') {
          // Resolve schema reference if needed
          const schema = resolveRef(param.schema, definitions);

          if (schema) {
            // Generate body content as JSON
            const bodyObj = generateBodyContent(schema, definitions);
            bodyContent = JSON.stringify(bodyObj, null, 2);

            // Add properties to custom params for tool input
            if (schema.properties) {
              Object.entries(schema.properties).forEach(([key, value]: [string, any]) => {
                customParams.push({
                  key,
                  description: value.description || '',
                  type: openApiTypeMap[value.type] || 'string',
                  required: schema.required?.includes(key) || false,
                  isTool: true
                });
              });
            }
          }
        }
      });

      // Handle security definitions
      const security = operation.security || parsed.security;
      if (security) {
        security.forEach((sec: any) => {
          if (sec.Authorization) {
            headerSecret = {
              Bearer: {
                value: '',
                secret: ''
              }
            };
          }
        });
      }

      // Determine body type
      let bodyType = ContentTypes.none;
      const consumes = operation.consumes || parsed.consumes || [];
      if (consumes.includes('application/json') || consumes.includes('*/*')) {
        bodyType = ContentTypes.json;
      } else if (consumes.includes('application/x-www-form-urlencoded')) {
        bodyType = ContentTypes.xWwwFormUrlencoded;
      } else if (consumes.includes('multipart/form-data')) {
        bodyType = ContentTypes.formData;
      }

      // If method is GET or DELETE, no body
      const httpMethod = method.toUpperCase() as HttpMethod;
      if (httpMethod === 'GET' || httpMethod === 'DELETE') {
        bodyType = ContentTypes.none;
      }

      const result: OpenApiImportResult = {
        name: operation.summary || operation.description || '',
        description: operation.summary || operation.description || '',
        method: httpMethod,
        path: url,
        ...(queryParams.length > 0 && { params: queryParams }),
        ...(headers.length > 0 && { headers }),
        bodyType,
        ...(bodyContent && { bodyContent }),
        ...(headerSecret && { headerSecret }),
        customParams
      };

      onImport(result);
      toast({
        title: t('common:import_success'),
        status: 'success'
      });
    } catch (error: any) {
      toast({
        title: t('common:import_failed'),
        description: error.message,
        status: 'error'
      });
      console.error('OpenAPI import error:', error);
    }
  };

  return (
    <MyModal
      isOpen
      onClose={onClose}
      iconSrc="modal/edit"
      title={t('common:core.module.http.openapi import')}
      w={600}
    >
      <ModalBody>
        <Textarea
          rows={20}
          mt={2}
          autoFocus
          {...register('openApiContent')}
          placeholder={t('common:core.module.http.openapi import placeholder')}
        />
      </ModalBody>
      <ModalFooter>
        <Button variant={'whiteBase'} mr={3} onClick={onClose}>
          {t('common:Close')}
        </Button>
        <Button onClick={handleSubmit(handleOpenApiImport)}>{t('common:Confirm')}</Button>
      </ModalFooter>
    </MyModal>
  );
};

export default React.memo(OpenApiImportModal);
