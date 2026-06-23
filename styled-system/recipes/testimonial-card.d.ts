/* eslint-disable */
import type { ConditionalValue } from '../types/index';
import type { DistributiveOmit, Pretty } from '../types/system-types';

interface TestimonialCardVariant {
  
}

type TestimonialCardVariantMap = {
  [key in keyof TestimonialCardVariant]: Array<TestimonialCardVariant[key]>
}



export type TestimonialCardVariantProps = {
  [key in keyof TestimonialCardVariant]?: ConditionalValue<TestimonialCardVariant[key]> | undefined
}

export interface TestimonialCardRecipe {
  
  __type: TestimonialCardVariantProps
  (props?: TestimonialCardVariantProps): string
  raw: (props?: TestimonialCardVariantProps) => TestimonialCardVariantProps
  variantMap: TestimonialCardVariantMap
  variantKeys: Array<keyof TestimonialCardVariant>
  splitVariantProps<Props extends TestimonialCardVariantProps>(props: Props): [TestimonialCardVariantProps, Pretty<DistributiveOmit<Props, keyof TestimonialCardVariantProps>>]
  getVariantProps: (props?: TestimonialCardVariantProps) => TestimonialCardVariantProps
}


export declare const testimonialCard: TestimonialCardRecipe