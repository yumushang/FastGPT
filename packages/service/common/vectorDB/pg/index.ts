/* pg vector crud */
import { DatasetVectorTableName, VectorVQ } from '../constants';
import { PgClient, connectPg } from './controller';
import type { VectorControllerType, UpdateCustomDataPropsType } from '../type';
import dayjs from 'dayjs';
import { getLogger, LogCategories } from '../../logger';

const logger = getLogger(LogCategories.INFRA.POSTGRES);

export class PgVectorCtrl implements VectorControllerType {
  constructor() {}
  init = async () => {
    const isHalfVec = VectorVQ === 16;

    try {
      await connectPg();
      await PgClient.query(`
        CREATE EXTENSION IF NOT EXISTS vector;
        CREATE TABLE IF NOT EXISTS ${DatasetVectorTableName} (
            id BIGSERIAL PRIMARY KEY,
            vector ${isHalfVec ? 'HALFVEC(1536)' : 'VECTOR(1536)'} NOT NULL,
            team_id VARCHAR(50) NOT NULL,
            dataset_id VARCHAR(50) NOT NULL,
            collection_id VARCHAR(50) NOT NULL,
            createtime TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            custom_data JSONB
        );
      `);

      // 迁移:旧版本建的表没有 custom_data 列，补充该列
      const { rowCount: customDataColumnCount } = await PgClient.query(`
        SELECT 1 FROM information_schema.columns
        WHERE table_name='${DatasetVectorTableName}' AND column_name='custom_data'
        LIMIT 1;
      `);
      if (customDataColumnCount === 0) {
        await PgClient.query(`ALTER TABLE ${DatasetVectorTableName} ADD COLUMN custom_data JSONB;`);
        logger.info('Added custom_data column to vector table');
      }

      await PgClient.query(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS vector_index ON ${DatasetVectorTableName} USING hnsw (vector ${isHalfVec ? 'halfvec_ip_ops' : 'vector_ip_ops'}) WITH (m = 32, ef_construction = 128);`
      );
      await PgClient.query(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS team_dataset_collection_index ON ${DatasetVectorTableName} USING btree(team_id, dataset_id, collection_id);`
      );
      await PgClient.query(
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS create_time_index ON ${DatasetVectorTableName} USING btree(createtime);`
      );
      // 10w rows
      // await PgClient.query(`
      //   ALTER TABLE modeldata SET (
      //     autovacuum_vacuum_scale_factor = 0.1,
      //     autovacuum_analyze_scale_factor = 0.05,
      //     autovacuum_vacuum_threshold = 50,
      //     autovacuum_analyze_threshold = 50,
      //     autovacuum_vacuum_cost_delay = 20,
      //     autovacuum_vacuum_cost_limit = 200
      //   );`);

      // 100w rows
      // await PgClient.query(`
      //   ALTER TABLE modeldata SET (
      //   autovacuum_vacuum_scale_factor = 0.01,
      //   autovacuum_analyze_scale_factor = 0.02,
      //   autovacuum_vacuum_threshold = 1000,
      //   autovacuum_analyze_threshold = 1000,
      //   autovacuum_vacuum_cost_delay = 10,
      //   autovacuum_vacuum_cost_limit = 2000
      // );`)

      logger.info('Postgres vector initialization completed');
    } catch (error) {
      logger.error('Postgres vector initialization failed', { error });
    }
  };
  insert: VectorControllerType['insert'] = async (props) => {
    const { teamId, datasetId, collectionId, vectors, customData } = props;

    const values = vectors.map((vector) => [
      { key: 'vector', value: `[${vector}]` },
      { key: 'team_id', value: String(teamId) },
      { key: 'dataset_id', value: String(datasetId) },
      { key: 'collection_id', value: String(collectionId) }
    ]);

    if (customData) {
      values.forEach((item) => {
        item.push({ key: 'custom_data', value: JSON.stringify(customData) });
      });
    }

    const { rowCount, rows } = await PgClient.insert(DatasetVectorTableName, {
      values
    });

    if (rowCount === 0) {
      return Promise.reject('insertDatasetData: no insert');
    }

    return {
      insertIds: rows.map((row) => row.id)
    };
  };
  delete: VectorControllerType['delete'] = async (props) => {
    const { teamId } = props;

    const teamIdWhere = `team_id='${String(teamId)}' AND`;

    const where = await (() => {
      if ('id' in props && props.id) return `${teamIdWhere} id=${props.id}`;

      if ('datasetIds' in props && props.datasetIds) {
        const datasetIdWhere = `dataset_id IN (${props.datasetIds
          .map((id) => `'${String(id)}'`)
          .join(',')})`;

        if ('collectionIds' in props && props.collectionIds) {
          return `${teamIdWhere} ${datasetIdWhere} AND collection_id IN (${props.collectionIds
            .map((id) => `'${String(id)}'`)
            .join(',')})`;
        }

        return `${teamIdWhere} ${datasetIdWhere}`;
      }

      if ('idList' in props && Array.isArray(props.idList)) {
        if (props.idList.length === 0) return;
        return `${teamIdWhere} id IN (${props.idList.map((id) => String(id)).join(',')})`;
      }
      return Promise.reject('deleteDatasetData: no where');
    })();

    if (!where) return;

    await PgClient.delete(DatasetVectorTableName, {
      where: [where]
    });
  };
  updateCustomData: VectorControllerType['updateCustomData'] = async (
    props: UpdateCustomDataPropsType
  ): Promise<void> => {
    const { teamId, idList, customData } = props;

    if (idList.length === 0 || !customData) return;

    const teamIdWhere = `team_id='${String(teamId)}' AND`;
    const where = `${teamIdWhere} id IN (${idList.map((id) => String(id)).join(',')})`;

    await PgClient.update(DatasetVectorTableName, {
      values: [{ key: 'custom_data', value: JSON.stringify(customData) }],
      where: [where]
    });
  };
  embRecall: VectorControllerType['embRecall'] = async (props) => {
    const { teamId, datasetIds, vector, limit, forbidCollectionIdList, filterCollectionIdList } =
      props;

    // Get forbid collection
    const formatForbidCollectionIdList = (() => {
      if (!filterCollectionIdList) return forbidCollectionIdList;
      const list = forbidCollectionIdList
        .map((id) => String(id))
        .filter((id) => !filterCollectionIdList.includes(id));
      return list;
    })();
    const forbidCollectionSql =
      formatForbidCollectionIdList.length > 0
        ? `AND collection_id NOT IN (${formatForbidCollectionIdList.map((id) => `'${id}'`).join(',')})`
        : '';

    // Filter by collectionId
    const formatFilterCollectionId = (() => {
      if (!filterCollectionIdList) return;

      return filterCollectionIdList
        .map((id) => String(id))
        .filter((id) => !forbidCollectionIdList.includes(id));
    })();
    const filterCollectionIdSql = formatFilterCollectionId
      ? `AND collection_id IN (${formatFilterCollectionId.map((id) => `'${id}'`).join(',')})`
      : '';
    // Empty data
    if (formatFilterCollectionId && formatFilterCollectionId.length === 0) {
      return { results: [] };
    }

    let customDataFilterMatch = '';
    if (props.customDataFilterMatch) {
      customDataFilterMatch = 'and ' + props.customDataFilterMatch;
      // console.log('PgClient.query customDataFilterMatch', customDataFilterMatch);
    }

    const sql = `BEGIN;
          SET LOCAL hnsw.ef_search = ${global.systemEnv?.hnswEfSearch || 100};
          SET LOCAL hnsw.max_scan_tuples = ${global.systemEnv?.hnswMaxScanTuples || 100000};
          SET LOCAL hnsw.iterative_scan = relaxed_order;
          WITH relaxed_results AS MATERIALIZED (
            select id, collection_id, vector <#> '[${vector}]' AS score
              from ${DatasetVectorTableName}
              where dataset_id IN (${datasetIds.map((id) => `'${String(id)}'`).join(',')})
                ${filterCollectionIdSql}
                ${forbidCollectionSql}
                ${customDataFilterMatch}
              order by score limit ${limit}
          ) SELECT id, collection_id, score FROM relaxed_results ORDER BY score;
        COMMIT;`;

    // addLog.debug('Pg embRecall SQL:', { sql });
    const results: any = await PgClient.query(sql);
    const rows = results?.[results.length - 2]?.rows as {
      id: string;
      collection_id: string;
      score: number;
    }[];

    if (!Array.isArray(rows)) {
      return {
        results: []
      };
    }

    return {
      results: rows.map((item) => ({
        id: String(item.id),
        collectionId: item.collection_id,
        score: item.score * -1
      }))
    };
  };

  getVectorDataByTime: VectorControllerType['getVectorDataByTime'] = async (start, end) => {
    const { rows } = await PgClient.query<{
      id: string;
      team_id: string;
      dataset_id: string;
    }>(`SELECT id, team_id, dataset_id
    FROM ${DatasetVectorTableName}
    WHERE createtime BETWEEN '${dayjs(start).format('YYYY-MM-DD HH:mm:ss')}' AND '${dayjs(
      end
    ).format('YYYY-MM-DD HH:mm:ss')}';
    `);

    return rows.map((item) => ({
      id: String(item.id),
      teamId: item.team_id,
      datasetId: item.dataset_id
    }));
  };
  getVectorCount: VectorControllerType['getVectorCount'] = async (props) => {
    const { teamId, datasetId, collectionId } = props;

    // Build where conditions dynamically
    const whereConditions: any[] = [];

    if (teamId) {
      whereConditions.push(['team_id', String(teamId)]);
    }

    if (datasetId) {
      if (whereConditions.length > 0) whereConditions.push('and');
      whereConditions.push(['dataset_id', String(datasetId)]);
    }

    if (collectionId) {
      if (whereConditions.length > 0) whereConditions.push('and');
      whereConditions.push(['collection_id', String(collectionId)]);
    }

    // If no conditions provided, count all
    const total = await PgClient.count(DatasetVectorTableName, {
      where: whereConditions.length > 0 ? whereConditions : undefined
    });

    return total;
  };
}
