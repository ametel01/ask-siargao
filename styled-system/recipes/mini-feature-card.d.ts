/* eslint-disable */
import type { ConditionalValue } from '../types/index';
import type { DistributiveOmit, Pretty } from '../types/system-types';

interface MiniFeatureCardVariant {
  
}

type MiniFeatureCardVariantMap = {
  [key in keyof MiniFeatureCardVariant]: Array<MiniFeatureCardVariant[key]>
}



export type MiniFeatureCardVariantProps = {
  [key in keyof MiniFeatureCardVariant]?: ConditionalValue<MiniFeatureCardVariant[key]> | undefined
}

export interface MiniFeatureCardRecipe {
  
  __type: MiniFeatureCardVariantProps
  (props?: MiniFeatureCardVariantProps): string
  raw: (props?: MiniFeatureCardVariantProps) => MiniFeatureCardVariantProps
  variantMap: MiniFeatureCardVariantMap
  variantKeys: Array<keyof MiniFeatureCardVariant>
  splitVariantProps<Props extends MiniFeatureCardVariantProps>(props: Props): [MiniFeatureCardVariantProps, Pretty<DistributiveOmit<Props, keyof MiniFeatureCardVariantProps>>]
  getVariantProps: (props?: MiniFeatureCardVariantProps) => MiniFeatureCardVariantProps
}


export declare const miniFeatureCard: MiniFeatureCardRecipe