import React, { useMemo } from 'react';
import MySelect from '@fastgpt/web/components/common/MySelect';
import { useSystemStore } from '@/web/common/system/useSystemStore';
import { useRequest } from '@fastgpt/web/hooks/useRequest';
import { useTranslation } from 'next-i18next';
import { HUGGING_FACE_ICON } from '@fastgpt/global/common/system/constants';
import { type SystemModelItemType } from '@fastgpt/service/core/ai/type';

const ModelFilterSelect = ({
  value,
  onChange,
  models
}: {
  value?: string;
  onChange: (val?: string) => void;
  /** 自定义候选模型列表,默认为 LLM + TTS + ReRank */
  models?: SystemModelItemType[];
}) => {
  const { t } = useTranslation();
  const { llmModelList, ttsModelList, reRankModelList, getModelProvider, getMyModelList } =
    useSystemStore();

  const { data: myModels } = useRequest(getMyModelList, {
    manual: false
  });

  const list = useMemo(() => {
    const allModels = models ?? [...llmModelList, ...ttsModelList, ...reRankModelList];
    const seen = new Set<string>();
    return [
      {
        label: t('common:all_models'),
        value: ''
      },
      ...allModels
        .filter((model) => {
          if (seen.has(model.model)) return false;
          if (myModels && !myModels.has(model.model)) return false;
          seen.add(model.model);
          return true;
        })
        .map((model) => ({
          icon: getModelProvider(model.provider)?.avatar || HUGGING_FACE_ICON,
          label: model.name,
          alias: model.model,
          value: model.model
        }))
    ];
  }, [models, llmModelList, ttsModelList, reRankModelList, myModels, getModelProvider, t]);

  return (
    <MySelect<string>
      className="nowheel"
      isSearch
      width={'200px'}
      placeholder={t('common:filter_by_model')}
      list={list}
      value={value}
      onChange={(val) => onChange(val || undefined)}
    />
  );
};

export default React.memo(ModelFilterSelect);
