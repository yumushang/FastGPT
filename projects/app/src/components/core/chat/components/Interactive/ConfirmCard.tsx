import React, { useMemo, useState } from 'react';
import { Box, Flex, Input, Checkbox, IconButton, Text } from '@chakra-ui/react';
import { useTranslation } from 'next-i18next';
import MyIcon from '@fastgpt/web/components/common/Icon';
import type { UserInputInteractive } from '@fastgpt/global/core/workflow/template/system/interactive/type';

type AnswerMap = Record<string, string | string[]>;

const isAnswered = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value.length > 0 : !!value;

const ConfirmCard = ({
  interactive,
  onAnswer
}: {
  interactive: UserInputInteractive;
  onAnswer: (text: string) => void;
}) => {
  const { t } = useTranslation();
  const fields = interactive.params.inputForm;

  const [answers, setAnswers] = useState<AnswerMap>(() =>
    Object.fromEntries(
      fields.map((f) => [f.key, f.value ?? (f.valueType === 'arrayString' ? [] : '')])
    )
  );
  const [idx, setIdx] = useState(0);
  const [draft, setDraft] = useState('');

  const field = fields[idx];
  const isMultiple = field?.valueType === 'arrayString';
  const allAnswered = useMemo(
    () => fields.every((f) => isAnswered(answers[f.key])),
    [fields, answers]
  );

  const submit = (map: AnswerMap) => onAnswer(JSON.stringify(map));
  const skip = () => onAnswer(JSON.stringify({ skip: true }));

  const settle = (map: AnswerMap, action: 'single' | 'custom' | 'toggle') => {
    setAnswers(map);
    const done = fields.every((f) => isAnswered(map[f.key]));
    if (done) {
      if (idx === fields.length - 1) {
        if (action !== 'toggle') submit(map);
      } else {
        setIdx(fields.length - 1);
      }
      return;
    }
    if (action !== 'toggle') {
      const next = fields.findIndex((f, i) => i !== idx && !isAnswered(map[f.key]));
      if (next >= 0) setIdx(next);
    }
  };

  const pickSingle = (value: string) => settle({ ...answers, [field.key]: value }, 'single');
  const toggleMultiple = (value: string) => {
    const cur = Array.isArray(answers[field.key]) ? (answers[field.key] as string[]) : [];
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    settle({ ...answers, [field.key]: next }, 'toggle');
  };
  const commitDraft = () => {
    const v = draft.trim();
    if (!v) return;
    const cur = answers[field.key];
    const next = isMultiple
      ? Array.isArray(cur) && cur.includes(v)
        ? cur
        : [...(Array.isArray(cur) ? cur : []), v]
      : v;
    setDraft('');
    settle({ ...answers, [field.key]: next }, 'custom');
  };
  const complete = () => {
    if (allAnswered) submit(answers);
  };

  if (!field) return null;

  return (
    <Box
      bg={'white'}
      border={'1px solid'}
      borderColor={'myGray.200'}
      borderRadius={'lg'}
      boxShadow={'0 4px 12px rgba(0,0,0,0.06)'}
      px={[3, 5]}
      py={3}
    >
      <Flex alignItems={'center'} gap={2} mb={2}>
        <Box flex={1} fontWeight={'medium'} fontSize={'sm'} color={'myGray.900'}>
          {field.label}
        </Box>
        <Flex alignItems={'center'} gap={1}>
          <IconButton
            aria-label="previous question"
            icon={<MyIcon name="common/arrowLeft" w={'14px'} />}
            size={'xs'}
            variant={'whiteBase'}
            isDisabled={idx === 0}
            onClick={() => setIdx(idx - 1)}
          />
          <Text fontSize={'xs'} color={'myGray.500'} whiteSpace={'nowrap'}>
            {idx + 1} / {fields.length}
          </Text>
          <IconButton
            aria-label="next question"
            icon={<MyIcon name="common/arrowRight" w={'14px'} />}
            size={'xs'}
            variant={'whiteBase'}
            isDisabled={idx === fields.length - 1 && !allAnswered}
            onClick={() => (idx === fields.length - 1 ? complete() : setIdx(idx + 1))}
          />
          <IconButton
            aria-label="skip confirmation"
            icon={<MyIcon name="common/closeLight" w={'14px'} />}
            size={'xs'}
            variant={'whiteBase'}
            onClick={skip}
          />
        </Flex>
      </Flex>

      <Flex flexDirection={'column'} gap={1} mb={2}>
        {field.list?.map((opt, i) => {
          const selected = isMultiple
            ? Array.isArray(answers[field.key]) &&
              (answers[field.key] as string[]).includes(opt.value)
            : answers[field.key] === opt.value;
          return (
            <Flex
              key={opt.value}
              alignItems={'flex-start'}
              gap={2}
              px={2}
              py={2}
              borderRadius={'md'}
              cursor={'pointer'}
              bg={selected && !isMultiple ? 'primary.50' : 'transparent'}
              _hover={{ bg: 'myGray.50' }}
              onClick={() => (isMultiple ? toggleMultiple(opt.value) : pickSingle(opt.value))}
            >
              {isMultiple ? (
                <Checkbox
                  isChecked={selected}
                  pointerEvents={'none'}
                  mt={'2px'}
                  colorScheme={'primary'}
                />
              ) : (
                <Flex
                  w={'22px'}
                  h={'22px'}
                  flexShrink={0}
                  alignItems={'center'}
                  justifyContent={'center'}
                  borderRadius={'full'}
                  bg={selected ? 'primary.500' : 'myGray.100'}
                  color={selected ? 'white' : 'myGray.600'}
                  fontSize={'xs'}
                  fontWeight={'medium'}
                >
                  {i + 1}
                </Flex>
              )}
              <Box>
                <Box fontSize={'sm'} fontWeight={'medium'} color={'myGray.900'}>
                  {opt.label}
                </Box>
                {opt.description && (
                  <Box fontSize={'xs'} color={'myGray.500'} mt={0.5}>
                    {opt.description}
                  </Box>
                )}
              </Box>
            </Flex>
          );
        })}
        {!field.list?.length && (
          <Input
            value={typeof answers[field.key] === 'string' ? (answers[field.key] as string) : ''}
            placeholder={t('chat:confirm_card_input_placeholder')}
            onChange={(e) => setAnswers({ ...answers, [field.key]: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') settle(answers, 'custom');
            }}
          />
        )}
      </Flex>

      <Flex alignItems={'center'} gap={2}>
        {!!field.list?.length && (
          <>
            <MyIcon name="common/edit" w={'16px'} color={'myGray.500'} />
            <Input
              flex={1}
              size={'sm'}
              border={'none'}
              _focus={{ boxShadow: 'none' }}
              placeholder={t('chat:confirm_card_input_placeholder')}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitDraft();
              }}
            />
          </>
        )}
        <Box flex={field.list?.length ? undefined : 1} />
        <IconButton
          aria-label="skip"
          icon={<Text fontSize={'sm'}>{t('chat:confirm_card_skip')}</Text>}
          size={'sm'}
          variant={'whiteBase'}
          border={'1px solid'}
          borderColor={'myGray.200'}
          borderRadius={'full'}
          px={4}
          onClick={skip}
        />
      </Flex>
    </Box>
  );
};

export const ConfirmCardSummary = ({ interactive }: { interactive: UserInputInteractive }) => {
  const { t } = useTranslation();
  return (
    <Flex flexDirection={'column'} gap={1}>
      {interactive.params.inputForm.map((f) => (
        <Box key={f.key} fontSize={'sm'} color={'myGray.700'}>
          <Text as={'span'} fontWeight={'medium'}>
            {f.label}：
          </Text>
          {Array.isArray(f.value)
            ? f.value.join('、') || t('chat:confirm_card_skip')
            : String(f.value ?? '') || t('chat:confirm_card_skip')}
        </Box>
      ))}
    </Flex>
  );
};

export default React.memo(ConfirmCard);
