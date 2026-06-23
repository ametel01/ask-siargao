/* eslint-disable */
import type { ConditionalValue } from '../types/index';
import type { DistributiveOmit, Pretty } from '../types/system-types';

interface RiskGaugeVariant {
  
}

type RiskGaugeVariantMap = {
  [key in keyof RiskGaugeVariant]: Array<RiskGaugeVariant[key]>
}



export type RiskGaugeVariantProps = {
  [key in keyof RiskGaugeVariant]?: ConditionalValue<RiskGaugeVariant[key]> | undefined
}

export interface RiskGaugeRecipe {
  
  __type: RiskGaugeVariantProps
  (props?: RiskGaugeVariantProps): string
  raw: (props?: RiskGaugeVariantProps) => RiskGaugeVariantProps
  variantMap: RiskGaugeVariantMap
  variantKeys: Array<keyof RiskGaugeVariant>
  splitVariantProps<Props extends RiskGaugeVariantProps>(props: Props): [RiskGaugeVariantProps, Pretty<DistributiveOmit<Props, keyof RiskGaugeVariantProps>>]
  getVariantProps: (props?: RiskGaugeVariantProps) => RiskGaugeVariantProps
}


export declare const riskGauge: RiskGaugeRecipe