import type { EmbeddingRecallItemType } from './type';

export type DeleteDatasetVectorProps = (
  | { id: string }
  | { datasetIds: string[]; collectionIds?: string[] }
  | { idList: string[] }
) & {
  teamId: string;
};
export type DelDatasetVectorCtrlProps = DeleteDatasetVectorProps & {
  retry?: number;
};

export type InsertVectorProps = {
  teamId: string;
  datasetId: string;
  collectionId: string;
  customData?: any;
};
export type InsertVectorControllerProps = InsertVectorProps & {
  vectors: number[][];
  customData?: any;
};

export type EmbeddingRecallProps = {
  teamId: string;
  datasetIds: string[];

  forbidCollectionIdList: string[];
  filterCollectionIdList?: string[];
};
export type EmbeddingRecallCtrlProps = EmbeddingRecallProps & {
  vector: number[];
  limit: number;
  retry?: number;
  customDataFilterMatch?: string;
};
export type EmbeddingRecallResponse = {
  results: EmbeddingRecallItemType[];
};

export type UpdateCustomDataProps = {
  teamId: string;
  idList: string[];
  customData?: any;
};
