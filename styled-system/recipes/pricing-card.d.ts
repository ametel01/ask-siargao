/* eslint-disable */
import type { ConditionalValue } from '../types/index';
import type { DistributiveOmit, Pretty } from '../types/system-types';

interface PricingCardVariant {
  
}

type PricingCardVariantMap = {
  [key in keyof PricingCardVariant]: Array<PricingCardVariant[key]>
}



export type PricingCardVariantProps = {
  [key in keyof PricingCardVariant]?: ConditionalValue<PricingCardVariant[key]> | undefined
}

export interface PricingCardRecipe {
  
  __type: PricingCardVariantProps
  (props?: PricingCardVariantProps): string
  raw: (props?: PricingCardVariantProps) => PricingCardVariantProps
  variantMap: PricingCardVariantMap
  variantKeys: Array<keyof PricingCardVariant>
  splitVariantProps<Props extends PricingCardVariantProps>(props: Props): [PricingCardVariantProps, Pretty<DistributiveOmit<Props, keyof PricingCardVariantProps>>]
  getVariantProps: (props?: PricingCardVariantProps) => PricingCardVariantProps
}


export declare const pricingCard: PricingCardRecipe