/* eslint-disable */
import type { ConditionalValue } from '../types/index';
import type { DistributiveOmit, Pretty } from '../types/system-types';

interface ProcessCardVariant {
  
}

type ProcessCardVariantMap = {
  [key in keyof ProcessCardVariant]: Array<ProcessCardVariant[key]>
}



export type ProcessCardVariantProps = {
  [key in keyof ProcessCardVariant]?: ConditionalValue<ProcessCardVariant[key]> | undefined
}

export interface ProcessCardRecipe {
  
  __type: ProcessCardVariantProps
  (props?: ProcessCardVariantProps): string
  raw: (props?: ProcessCardVariantProps) => ProcessCardVariantProps
  variantMap: ProcessCardVariantMap
  variantKeys: Array<keyof ProcessCardVariant>
  splitVariantProps<Props extends ProcessCardVariantProps>(props: Props): [ProcessCardVariantProps, Pretty<DistributiveOmit<Props, keyof ProcessCardVariantProps>>]
  getVariantProps: (props?: ProcessCardVariantProps) => ProcessCardVariantProps
}


export declare const processCard: ProcessCardRecipe