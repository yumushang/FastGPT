import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Flex,
  Table,
  TableContainer,
  Tbody,
  Td,
  Th,
  Thead,
  Tr
} from '@chakra-ui/react';
import { useTranslation } from 'next-i18next';
import { useRouter } from 'next/router';
import { addDays, format } from 'date-fns';
import MyIcon from '@fastgpt/web/components/common/Icon';
import MyRightDrawer from '@fastgpt/web/components/common/MyDrawer/MyRightDrawer';
import MyBox from '@fastgpt/web/components/common/MyBox';
import EmptyTip from '@fastgpt/web/components/common/EmptyTip';
import Avatar from '@fastgpt/web/components/common/Avatar';
import DateRangePicker, {
  type DateRangeType
} from '@fastgpt/web/components/common/DateRangePicker';
import MultipleSelect, {
  useMultipleSelect
} from '@fastgpt/web/components/common/MySelect/MultipleSelect';
import { ChatSourceEnum, ChatSourceMap } from '@fastgpt/global/core/chat/constants';
import type { AppTypeEnum } from '@fastgpt/global/core/app/constants';
import { useRequest } from '@fastgpt/web/hooks/useRequest';
import { getTeamAppChatStats } from '@/web/core/app/api/log';
import AppTypeTag from '../TypeTag';
import { appTypeTagMap } from '../../constant';

const ChatStatsDrawer = ({ onClose }: { onClose: () => void }) => {
  const { t } = useTranslation();
  const router = useRouter();

  const [dateRange, setDateRange] = useState<DateRangeType>({
    from: new Date(addDays(new Date(), -6).setHours(0, 0, 0, 0)),
    to: new Date(new Date().setHours(23, 59, 59, 999))
  });

  const {
    value: chatSources,
    setValue: setChatSources,
    isSelectAll: isSelectAllSource,
    setIsSelectAll: setIsSelectAllSource
  } = useMultipleSelect<ChatSourceEnum>(Object.values(ChatSourceEnum), true);

  const sourceList = useMemo(
    () =>
      Object.entries(ChatSourceMap).map(([key, value]) => ({
        label: t(value.name as any),
        value: key as ChatSourceEnum
      })),
    [t]
  );

  const params = useMemo(
    () => ({
      dateStart: dateRange.from,
      dateEnd: dateRange.to,
      sources: isSelectAllSource ? undefined : chatSources
    }),
    [dateRange.from, dateRange.to, isSelectAllSource, chatSources]
  );

  const { data, loading } = useRequest(() => getTeamAppChatStats(params), {
    manual: false,
    refreshDeps: [params]
  });

  const list = data?.list ?? [];

  const onExport = () => {
    const escapeCsvCell = (cell: string | number) => {
      const content = String(cell).trim();
      if (content.includes(',') || content.includes('"') || content.includes('\n')) {
        return `"${content.replace(/"/g, '""')}"`;
      }
      return content;
    };
    const getTypeLabel = (type: string) => {
      const labelKey = appTypeTagMap[type as keyof typeof appTypeTagMap]?.label;
      return labelKey ? t(labelKey as any) : type;
    };

    const header = [
      t('common:Name'),
      t('common:support.standard.type'),
      t('app:logs_chat_count'),
      t('app:logs_error_count'),
      t('app:team_chat_stats_user_count')
    ];
    const rows = list.map((item) => [
      item.name,
      getTypeLabel(item.type),
      item.chatCount,
      item.errorCount,
      item.userCount
    ]);
    rows.push([t('app:team_chat_stats_total'), '', data?.totalChatCount ?? 0, '', '']);

    const csvContent = [header, ...rows].map((row) => row.map(escapeCsvCell).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${t('app:team_chat_stats_title')}_${format(dateRange.from, 'yyyyMMdd')}-${format(dateRange.to, 'yyyyMMdd')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <MyRightDrawer
      onClose={onClose}
      title={t('app:team_chat_stats_title')}
      maxW={['90vw', '700px']}
    >
      <MyBox isLoading={loading} display={'flex'} flexDirection={'column'} h={'full'} py={4}>
        <Flex alignItems={'center'} gap={3} flexWrap={'wrap'}>
          <Flex>
            <MultipleSelect<ChatSourceEnum>
              list={sourceList}
              value={chatSources}
              onSelect={setChatSources}
              isSelectAll={isSelectAllSource}
              setIsSelectAll={setIsSelectAllSource}
              h={9}
              w={'180px'}
              rounded={'8px'}
              tagStyle={{
                px: 1,
                py: 1,
                borderRadius: 'sm',
                bg: 'myGray.100',
                color: 'myGray.900'
              }}
              borderColor={'myGray.200'}
              formLabel={t('app:logs_source')}
              formLabelFontSize={'sm'}
            />
          </Flex>
          <Flex>
            <DateRangePicker
              defaultDate={dateRange}
              onSuccess={(date) => {
                setDateRange(date);
              }}
              bg={'white'}
              h={9}
              flex={'0 1 230px'}
              rounded={'8px'}
              borderColor={'myGray.200'}
              formLabel={t('app:logs_date')}
              _hover={{
                borderColor: 'primary.300'
              }}
            />
          </Flex>
          <Box flex={'1'} />
          <Button
            variant={'grayBase'}
            size={'sm'}
            h={9}
            leftIcon={<MyIcon name={'common/download'} w={'14px'} />}
            onClick={onExport}
            isDisabled={list.length === 0}
          >
            {t('common:Export')}
          </Button>
        </Flex>

        <TableContainer mt={4} flex={'1 0 0'} overflowY={'auto'}>
          <Table variant={'simple'} fontSize={'sm'}>
            <Thead>
              <Tr>
                <Th>{t('common:Name')}</Th>
                <Th>{t('common:support.standard.type')}</Th>
                <Th isNumeric>{t('app:logs_chat_count')}</Th>
                <Th isNumeric>{t('app:logs_error_count')}</Th>
                <Th isNumeric>{t('app:team_chat_stats_user_count')}</Th>
              </Tr>
            </Thead>
            <Tbody fontSize={'sm'}>
              {list.map((item) => (
                <Tr
                  key={item.appId}
                  cursor={'pointer'}
                  _hover={{ bg: 'myWhite.600' }}
                  onClick={() => router.push(`/app/detail?appId=${item.appId}`)}
                >
                  <Td>
                    <Flex alignItems={'center'}>
                      <Avatar src={item.avatar} w={'20px'} mr={2} borderRadius={'sm'} />
                      <Box className="textEllipsis" maxW={'180px'} title={item.name}>
                        {item.name}
                      </Box>
                    </Flex>
                  </Td>
                  <Td>
                    <AppTypeTag type={item.type as AppTypeEnum} />
                  </Td>
                  <Td isNumeric>{item.chatCount}</Td>
                  <Td isNumeric>{item.errorCount || '-'}</Td>
                  <Td isNumeric>{item.userCount}</Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
          {list.length === 0 && !loading && <EmptyTip text={t('app:logs_empty')} />}
        </TableContainer>

        {list.length > 0 && (
          <Flex
            mt={3}
            pt={3}
            borderTop={'1px solid'}
            borderColor={'myGray.200'}
            fontSize={'sm'}
            fontWeight={'medium'}
            alignItems={'center'}
          >
            <Box>{t('app:team_chat_stats_total')}</Box>
            <Box flex={'1'} />
            <Box>
              {t('app:logs_chat_count')}: {data?.totalChatCount ?? 0}
            </Box>
          </Flex>
        )}
      </MyBox>
    </MyRightDrawer>
  );
};

export default React.memo(ChatStatsDrawer);
