import { describe, expect, it } from 'vitest';
import { insertData2Dataset, updateData2Dataset } from '@/service/core/dataset/data/controller';
import { MongoDatasetData } from '@fastgpt/service/core/dataset/data/schema';
import { MongoDatasetDataText } from '@fastgpt/service/core/dataset/data/dataTextSchema';
import { InsertDataBodySchema } from '@fastgpt/global/openapi/core/dataset/data/api';

const embeddingModel = 'text-embedding-ada-002';
const teamId = '65ab0f0f0f0f0f0f0f0f0001';
const tmbId = '65ab0f0f0f0f0f0f0f0f0002';

describe('customData save to mongo', () => {
  const datasetId = '65ab0f0f0f0f0f0f0f0f0011';
  const collectionId = '65ab0f0f0f0f0f0f0f0f0022';

  it('API schema parse -> insertData2Dataset full chain saves customData', async () => {
    // 模拟前端发出的请求体，走完整的 schema parse + controller 链路
    const requestBody = {
      collectionId,
      q: '全链路测试',
      a: '',
      indexes: [],
      customData: { dept: '信访办', level: '3' }
    };
    const parsed = InsertDataBodySchema.parse(requestBody);
    console.log('API parsed customData:', JSON.stringify(parsed.customData));

    const { insertId } = await insertData2Dataset({
      teamId,
      tmbId,
      datasetId,
      collectionId,
      q: parsed.q,
      a: parsed.a,
      chunkIndex: 0,
      embeddingModel,
      indexes: parsed.indexes as any,
      customData: parsed.customData as any
    });

    const mongoData = await MongoDatasetData.findById(insertId).lean();
    console.log('full-chain dataset_datas customData:', JSON.stringify(mongoData?.customData));
    expect(mongoData?.customData).toEqual({ dept: '信访办', level: '3' });
  });

  it('insertData2Dataset should save customData to dataset_datas and dataset_data_texts', async () => {
    const { insertId } = await insertData2Dataset({
      teamId,
      tmbId,
      datasetId,
      collectionId,
      q: '测试数据',
      a: '',
      chunkIndex: 0,
      embeddingModel,
      indexes: [{ type: 'custom', text: '自定义索引' } as any],
      customData: { dept: '信访办', level: '3' }
    });

    const mongoData = await MongoDatasetData.findById(insertId).lean();
    console.log('insert dataset_datas customData:', JSON.stringify(mongoData?.customData));
    expect(mongoData?.customData).toEqual({ dept: '信访办', level: '3' });

    const textData = await MongoDatasetDataText.findOne({ dataId: insertId }).lean();
    console.log('insert dataset_data_texts customData:', JSON.stringify(textData?.customData));
    expect(textData?.customData).toEqual({ dept: '信访办', level: '3' });
  });

  it('updateData2Dataset should save customData to dataset_datas and dataset_data_texts', async () => {
    const { insertId } = await insertData2Dataset({
      teamId,
      tmbId,
      datasetId,
      collectionId,
      q: '测试数据',
      a: '',
      chunkIndex: 0,
      embeddingModel,
      indexes: [],
      customData: { dept: '信访办' }
    });

    await updateData2Dataset({
      dataId: String(insertId),
      q: '测试数据-更新',
      a: '',
      indexes: [{ type: 'custom', text: '更新后的索引' } as any],
      model: embeddingModel,
      customData: { dept: '信访办', level: '5' }
    });

    const mongoData = await MongoDatasetData.findById(insertId).lean();
    console.log('update dataset_datas customData:', JSON.stringify(mongoData?.customData));
    expect(mongoData?.customData).toEqual({ dept: '信访办', level: '5' });

    const textData = await MongoDatasetDataText.findOne({ dataId: insertId }).lean();
    console.log('update dataset_data_texts customData:', JSON.stringify(textData?.customData));
    expect(textData?.customData).toEqual({ dept: '信访办', level: '5' });
  });
});
