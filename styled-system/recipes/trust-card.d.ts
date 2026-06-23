/* eslint-disable */
import type { ConditionalValue } from '../types/index';
import type { DistributiveOmit, Pretty } from '../types/system-types';

interface TrustCardVariant {
  
}

type TrustCardVariantMap = {
  [key in keyof TrustCardVariant]: Array<TrustCardVariant[key]>
}



export type TrustCardVariantProps = {
  [key in keyof TrustCardVariant]?: ConditionalValue<TrustCardVariant[key]> | undefined
}

export interface TrustCardRecipe {
  
  __type: TrustCardVariantProps
  (props?: TrustCardVariantProps): string
  raw: (props?: TrustCardVariantProps) => TrustCardVariantProps
  variantMap: TrustCardVariantMap
  variantKeys: Array<keyof TrustCardVariant>
  splitVariantProps<Props extends TrustCardVariantProps>(props: Props): [TrustCardVariantProps, Pretty<DistributiveOmit<Props, keyof TrustCardVariantProps>>]
  getVariantProps: (props?: TrustCardVariantProps) => TrustCardVariantProps
}


export declare const trustCard: TrustCardRecipe