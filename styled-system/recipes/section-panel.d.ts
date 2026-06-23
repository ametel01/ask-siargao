/* eslint-disable */
import type { ConditionalValue } from '../types/index';
import type { DistributiveOmit, Pretty } from '../types/system-types';

interface SectionPanelVariant {
  
}

type SectionPanelVariantMap = {
  [key in keyof SectionPanelVariant]: Array<SectionPanelVariant[key]>
}



export type SectionPanelVariantProps = {
  [key in keyof SectionPanelVariant]?: ConditionalValue<SectionPanelVariant[key]> | undefined
}

export interface SectionPanelRecipe {
  
  __type: SectionPanelVariantProps
  (props?: SectionPanelVariantProps): string
  raw: (props?: SectionPanelVariantProps) => SectionPanelVariantProps
  variantMap: SectionPanelVariantMap
  variantKeys: Array<keyof SectionPanelVariant>
  splitVariantProps<Props extends SectionPanelVariantProps>(props: Props): [SectionPanelVariantProps, Pretty<DistributiveOmit<Props, keyof SectionPanelVariantProps>>]
  getVariantProps: (props?: SectionPanelVariantProps) => SectionPanelVariantProps
}


export declare const sectionPanel: SectionPanelRecipe