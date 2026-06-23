/* eslint-disable */
import type { ConditionalValue } from '../types/index';
import type { DistributiveOmit, Pretty } from '../types/system-types';

interface PageShellVariant {
  
}

type PageShellVariantMap = {
  [key in keyof PageShellVariant]: Array<PageShellVariant[key]>
}



export type PageShellVariantProps = {
  [key in keyof PageShellVariant]?: ConditionalValue<PageShellVariant[key]> | undefined
}

export interface PageShellRecipe {
  
  __type: PageShellVariantProps
  (props?: PageShellVariantProps): string
  raw: (props?: PageShellVariantProps) => PageShellVariantProps
  variantMap: PageShellVariantMap
  variantKeys: Array<keyof PageShellVariant>
  splitVariantProps<Props extends PageShellVariantProps>(props: Props): [PageShellVariantProps, Pretty<DistributiveOmit<Props, keyof PageShellVariantProps>>]
  getVariantProps: (props?: PageShellVariantProps) => PageShellVariantProps
}


export declare const pageShell: PageShellRecipe