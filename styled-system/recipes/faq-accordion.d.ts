/* eslint-disable */
import type { ConditionalValue } from '../types/index';
import type { DistributiveOmit, Pretty } from '../types/system-types';

interface FaqAccordionVariant {
  
}

type FaqAccordionVariantMap = {
  [key in keyof FaqAccordionVariant]: Array<FaqAccordionVariant[key]>
}



export type FaqAccordionVariantProps = {
  [key in keyof FaqAccordionVariant]?: ConditionalValue<FaqAccordionVariant[key]> | undefined
}

export interface FaqAccordionRecipe {
  
  __type: FaqAccordionVariantProps
  (props?: FaqAccordionVariantProps): string
  raw: (props?: FaqAccordionVariantProps) => FaqAccordionVariantProps
  variantMap: FaqAccordionVariantMap
  variantKeys: Array<keyof FaqAccordionVariant>
  splitVariantProps<Props extends FaqAccordionVariantProps>(props: Props): [FaqAccordionVariantProps, Pretty<DistributiveOmit<Props, keyof FaqAccordionVariantProps>>]
  getVariantProps: (props?: FaqAccordionVariantProps) => FaqAccordionVariantProps
}


export declare const faqAccordion: FaqAccordionRecipe