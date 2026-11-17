import { Box, Button, Flex, Input, ModalBody, ModalFooter } from '@chakra-ui/react';
import React, { useState } from 'react';
import MyIcon from '@fastgpt/web/components/common/Icon';
import FormLabel from '@fastgpt/web/components/common/MyBox/FormLabel';
import { useTranslation } from 'next-i18next';
import { useRequest } from '@fastgpt/web/hooks/useRequest';
import { AppContext } from '../../context';
import { useContextSelector } from 'use-context-selector';
import MyIconButton from '@fastgpt/web/components/common/Icon/button';
import {
  type McpToolConfigType,
  MCP_TOOL_MODEL_NAME_REGEX
} from '@fastgpt/global/core/app/tool/mcpTool/type';
import MyModal from '@fastgpt/web/components/common/MyModal';
import Avatar from '@fastgpt/web/components/common/Avatar';
import MyBox from '@fastgpt/web/components/common/MyBox';
import type { GetMcpToolsBodyType } from '@fastgpt/global/openapi/core/app/mcpTools/api';
import { getMCPTools } from '@/web/core/app/api/mcpTools';
import HeaderAuthConfig from '@/components/common/secret/HeaderAuthConfig';
import { type StoreSecretValueType } from '@fastgpt/global/common/secret/type';
import type { JsonSchemaPropertiesItemType } from '@fastgpt/global/core/app/jsonschema';

const EditForm = ({
  url,
  setUrl,
  toolList,
  setToolList,
  currentTool,
  setCurrentTool,
  headerSecret,
  setHeaderSecret
}: {
  url: string;
  setUrl: (url: string) => void;
  toolList: McpToolConfigType[];
  setToolList: (toolList: McpToolConfigType[]) => void;
  currentTool?: McpToolConfigType;
  setCurrentTool: (tool: McpToolConfigType) => void;
  headerSecret: StoreSecretValueType;
  setHeaderSecret: (headerSecret: StoreSecretValueType) => void;
}) => {
  const { t } = useTranslation();

  const [toolDetail, setToolDetail] = useState<McpToolConfigType | null>(null);

  const { runAsync: runGetMCPTools, loading: isGettingTools } = useRequest(
    async (data: GetMcpToolsBodyType) => await getMCPTools(data),
    {
      onSuccess: (res) => {
        // 重新解析拿到的是远端模板，不携带 modelName；按 name 回填，避免丢失用户配置的模型名称。
        const mergedList = res.map((tool) => {
          const modelName = toolList.find((item) => item.name === tool.name)?.modelName;
          return modelName === undefined ? tool : { ...tool, modelName };
        });
        setToolList(mergedList);
        setCurrentTool(mergedList[0]);
      },
      errorToast: t('app:MCP_tools_parse_failed')
    }
  );

  return (
    <>
      <Box p={6}>
        <Flex alignItems={'center'}>
          <MyIcon name={'common/linkBlue'} w={'20px'} />
          <FormLabel ml={2} flex={1}>
            {t('app:MCP_tools_url')}
          </FormLabel>
          <HeaderAuthConfig
            storeHeaderSecretConfig={headerSecret}
            onUpdate={setHeaderSecret}
            buttonProps={{
              size: 'sm',
              variant: 'grayGhost'
            }}
          />
        </Flex>
        <Flex alignItems={'center'} gap={2} mt={3}>
          <Input
            h={8}
            placeholder={t('app:MCP_tools_url_placeholder')}
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
          <Button
            size={'sm'}
            variant={'whitePrimary'}
            h={8}
            isLoading={isGettingTools}
            onClick={() => {
              runGetMCPTools({ url, headerSecret });
            }}
          >
            {t('common:Parse')}
          </Button>
        </Flex>

        <Flex alignItems={'center'} mt={6}>
          <MyIcon name={'common/list'} w={'20px'} color={'primary.600'} />
          <FormLabel ml={2} flex={1}>
            {t('app:MCP_tools_list_with_number', {
              total: toolList.length || 0
            })}
          </FormLabel>
        </Flex>

        <Box mt={3}>
          {toolList.map((tool, index) => {
            return (
              <MyBox
                key={tool.name}
                role="group"
                position="relative"
                border={'1px solid'}
                {...(currentTool?.name === tool.name
                  ? {
                      borderRadius: '8px',
                      borderColor: 'primary.600',
                      borderBottomColor: 'primary.600',
                      boxShadow:
                        '0px 4px 4px 0px rgba(19, 51, 107, 0.05), 0px 0px 1px 0px rgba(19, 51, 107, 0.08)'
                    }
                  : {
                      borderRadius: 'none',
                      borderColor: 'transparent',
                      borderBottomColor: 'myGray.150',
                      boxShadow: 'none'
                    })}
                _hover={{
                  borderRadius: '8px',
                  boxShadow:
                    '0px 4px 4px 0px rgba(19, 51, 107, 0.05), 0px 0px 1px 0px rgba(19, 51, 107, 0.08)'
                }}
                cursor={'pointer'}
                onClick={() => {
                  setCurrentTool(tool);
                }}
              >
                <Flex alignItems={'center'} py={2} px={3}>
                  <Box w={'20px'} fontSize={'14px'} color={'myGray.500'} fontWeight={'medium'}>
                    {index + 1 < 10 ? `0${index + 1}` : index + 1}
                  </Box>
                  <Box maxW={'full'} pl={2} position="relative" width="calc(100% - 30px)">
                    <Box
                      fontSize={'14px'}
                      color={'myGray.900'}
                      whiteSpace="nowrap"
                      overflow="hidden"
                      textOverflow="ellipsis"
                    >
                      {tool.name}
                    </Box>
                    <Box
                      fontSize={'12px'}
                      color={'myGray.500'}
                      whiteSpace="nowrap"
                      overflow="hidden"
                      textOverflow="ellipsis"
                    >
                      {tool.description || t('app:tools_no_description')}
                    </Box>
                    {tool.modelName && (
                      <Box
                        fontSize={'11px'}
                        color={'primary.600'}
                        whiteSpace="nowrap"
                        overflow="hidden"
                        textOverflow="ellipsis"
                      >
                        {t('app:MCP_tools_model_name')}: {tool.modelName}
                      </Box>
                    )}
                  </Box>
                  <Box flex={1} />
                </Flex>

                <Flex
                  position="absolute"
                  right={3}
                  top="50%"
                  transform="translateY(-50%)"
                  gap={2}
                  display="none"
                  _groupHover={{ display: 'flex' }}
                  background="linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,1) 15%, rgba(255,255,255,1) 100%)"
                  paddingLeft="20px"
                >
                  <MyIconButton
                    size={'16px'}
                    icon={'common/detail'}
                    p={2}
                    border={'1px solid'}
                    borderColor={'myGray.250'}
                    hoverBg={'rgba(51, 112, 255, 0.10)'}
                    hoverBorderColor={'primary.300'}
                    tip={t('app:MCP_tools_detail')}
                    onClick={(e) => {
                      e.stopPropagation();
                      setToolDetail(tool);
                    }}
                  />
                </Flex>
              </MyBox>
            );
          })}
        </Box>
      </Box>

      {toolDetail && (
        <ToolDetailModal
          tool={toolDetail}
          toolList={toolList}
          onClose={() => setToolDetail(null)}
          onUpdate={(updatedTool) => {
            setToolList(
              toolList.map((item) => (item.name === updatedTool.name ? updatedTool : item))
            );
            if (currentTool?.name === updatedTool.name) setCurrentTool(updatedTool);
          }}
        />
      )}
    </>
  );
};

export default React.memo(EditForm);

const ToolDetailModal = ({
  tool,
  toolList,
  onClose,
  onUpdate
}: {
  tool: McpToolConfigType;
  toolList: McpToolConfigType[];
  onClose: () => void;
  onUpdate: (tool: McpToolConfigType) => void;
}) => {
  const { t } = useTranslation();
  const appDetail = useContextSelector(AppContext, (v) => v.appDetail);

  const [modelName, setModelName] = useState(tool.modelName ?? '');

  // 模型名称校验：留空视为未配置（运行时自动生成）；非空时校验 ASCII 规则与工具集内唯一性。
  const modelNameError = (() => {
    if (modelName === '') return undefined;
    if (!MCP_TOOL_MODEL_NAME_REGEX.test(modelName)) {
      return t('app:MCP_tools_model_name_invalid');
    }
    const isDuplicate = toolList.some(
      (item) => item.name !== tool.name && item.modelName === modelName
    );
    if (isDuplicate) return t('app:MCP_tools_model_name_duplicate');
    return undefined;
  })();

  return (
    <MyModal
      isOpen={true}
      iconSrc="common/detail"
      iconColor={'primary.600'}
      title={t('app:tool_detail')}
      onClose={onClose}
      w={'530px'}
    >
      <ModalBody>
        <Flex
          pb={6}
          borderBottom={'1px solid'}
          borderColor={'myGray.200'}
          alignItems={'flex-start'}
        >
          <Avatar src={appDetail.avatar} borderRadius={'md'} w={'40px'} />
          <Box ml={'14px'}>
            <Box fontSize={'16px'} color={'myGray.900'}>
              {tool.name}
            </Box>
            <Box fontSize={'12px'} color={'myGray.500'} maxH={'100px'} overflow={'auto'}>
              {tool.description}
            </Box>
          </Box>
        </Flex>

        <Box mt={6}>
          <FormLabel>{t('app:MCP_tools_model_name')}</FormLabel>
          <Input
            mt={2}
            h={8}
            fontFamily={'mono'}
            placeholder={t('app:MCP_tools_model_name_placeholder')}
            value={modelName}
            isInvalid={modelNameError !== undefined}
            onChange={(e) => setModelName(e.target.value)}
          />
          <Box mt={1} fontSize={'12px'} color={modelNameError ? 'red.500' : 'myGray.500'}>
            {modelNameError ?? t('app:MCP_tools_model_name_tip')}
          </Box>
        </Box>

        <Box mt={6} color={'myGray.900'} fontWeight={'medium'}>
          {t('app:raw_params')}
        </Box>

        <Box mt={3}>
          {Object.entries(tool.inputSchema?.properties || {}).map(
            ([paramName, paramInfo]: [string, JsonSchemaPropertiesItemType]) => (
              <Box key={paramName} py={2} borderBottom={'1px solid'} borderColor={'myGray.150'}>
                <Flex alignItems="center">
                  {tool.inputSchema?.required?.includes(paramName) && (
                    <Box mr={1} color="red.500">
                      *
                    </Box>
                  )}
                  <Box fontSize="14px" color="myGray.900">
                    {paramName}
                  </Box>

                  <Box
                    ml={1}
                    fontSize={'12px'}
                    color={'myGray.600'}
                    px={1}
                    bg={'myGray.25'}
                    borderRadius={'sm'}
                    border={'1px solid'}
                    borderColor={'myGray.200'}
                  >
                    {paramInfo.type ||
                      paramInfo.anyOf?.map((item) => item.type).join(',') ||
                      paramInfo.oneOf?.map((item) => item.type).join(',') ||
                      paramInfo.allOf?.map((item) => item.type).join(',') ||
                      'any'}
                  </Box>
                </Flex>

                <Box mt={1} fontSize="13px" color="myGray.600">
                  {paramInfo.description}
                </Box>
              </Box>
            )
          )}
        </Box>
      </ModalBody>
      <ModalFooter>
        <Button
          size={'md'}
          isDisabled={modelNameError !== undefined}
          onClick={() => {
            onUpdate({ ...tool, modelName: modelName === '' ? undefined : modelName });
            onClose();
          }}
        >
          {t('common:Confirm')}
        </Button>
      </ModalFooter>
    </MyModal>
  );
};
