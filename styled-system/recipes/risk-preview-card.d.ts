/* eslint-disable */
import type { ConditionalValue } from '../types/index';
import type { DistributiveOmit, Pretty } from '../types/system-types';

interface RiskPreviewCardVariant {
  
}

type RiskPreviewCardVariantMap = {
  [key in keyof RiskPreviewCardVariant]: Array<RiskPreviewCardVariant[key]>
}



export type RiskPreviewCardVariantProps = {
  [key in keyof RiskPreviewCardVariant]?: ConditionalValue<RiskPreviewCardVariant[key]> | undefined
}

export interface RiskPreviewCardRecipe {
  
  __type: RiskPreviewCardVariantProps
  (props?: RiskPreviewCardVariantProps): string
  raw: (props?: RiskPreviewCardVariantProps) => RiskPreviewCardVariantProps
  variantMap: RiskPreviewCardVariantMap
  variantKeys: Array<keyof RiskPreviewCardVariant>
  splitVariantProps<Props extends RiskPreviewCardVariantProps>(props: Props): [RiskPreviewCardVariantProps, Pretty<DistributiveOmit<Props, keyof RiskPreviewCardVariantProps>>]
  getVariantProps: (props?: RiskPreviewCardVariantProps) => RiskPreviewCardVariantProps
}


export declare const riskPreviewCard: RiskPreviewCardRecipe