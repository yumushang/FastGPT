import { describe, expect, it } from 'vitest';
import { convertSqlCondition } from '@fastgpt/service/common/util/convertSqlCondition';
import { InsertDataBodySchema } from '@fastgpt/global/openapi/core/dataset/data/api';
import { UpdateDatasetDataPropsSchema } from '@fastgpt/global/core/dataset/type';

describe('convertSqlCondition', () => {
  it('like requires % in value', () => {
    const res = convertSqlCondition("name like '张三'");
    expect(res.error).toBeDefined();
  });

  it('like with % wildcard', () => {
    const res = convertSqlCondition("name LIKE '%张三%'");
    expect(res.error).toBeUndefined();
    expect(res.pgJsonb).toBe("custom_data->>'name' LIKE '%张三%'");
    expect(JSON.parse(res.mongoDb!)).toEqual({ 'custom_data.name': { $regex: '.*张三.*' } });
  });

  it('like escapes regex special chars', () => {
    const res = convertSqlCondition("code like '%a.b(c)%'");
    expect(res.error).toBeUndefined();
    expect(JSON.parse(res.mongoDb!)).toEqual({
      'custom_data.code': { $regex: '.*a\\.b\\(c\\).*' }
    });
  });

  it('like combined with and/or', () => {
    const res = convertSqlCondition("name like '张%' and age > 18 or city = '北京'");
    expect(res.error).toBeUndefined();
    expect(res.pgJsonb).toBe(
      "((custom_data->>'name' LIKE '张%') AND (custom_data->>'age' > '18')) OR (custom_data->>'city' = '北京')"
    );
    const mongo = JSON.parse(res.mongoDb!);
    expect(mongo.$or).toBeDefined();
  });

  it('like rejects unquoted value', () => {
    const res = convertSqlCondition('name like 张三');
    expect(res.error).toBeDefined();
  });

  it('escapes single quotes in value', () => {
    const res = convertSqlCondition("name = 'o''brien'");
    expect(res.error).toBeUndefined();
    expect(res.pgJsonb).toBe("custom_data->>'name' = 'o''brien'");
  });

  it('still supports in operator', () => {
    const res = convertSqlCondition("status in ('a','b')");
    expect(res.error).toBeUndefined();
    expect(res.pgJsonb).toBe("custom_data->>'status' IN ('a','b')");
    expect(JSON.parse(res.mongoDb!)).toEqual({ 'custom_data.status': { $in: ['a', 'b'] } });
  });
});

describe('customData schema', () => {
  it('InsertDataBodySchema keeps customData keys', () => {
    const parsed = InsertDataBodySchema.parse({
      collectionId: '68ad85a7463006c963799a06',
      q: 'test',
      customData: { dept: '信访办', level: 3 }
    });
    expect(parsed.customData).toEqual({ dept: '信访办', level: 3 });
  });

  it('UpdateDatasetDataPropsSchema keeps customData keys', () => {
    const parsed = UpdateDatasetDataPropsSchema.parse({
      dataId: '68ad85a7463006c963799a05',
      q: 'test',
      customData: { dept: '信访办' }
    });
    expect(parsed.customData).toEqual({ dept: '信访办' });
  });
});
