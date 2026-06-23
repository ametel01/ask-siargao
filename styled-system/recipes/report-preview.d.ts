/* eslint-disable */
import type { ConditionalValue } from '../types/index';
import type { DistributiveOmit, Pretty } from '../types/system-types';

interface ReportPreviewVariant {
  
}

type ReportPreviewVariantMap = {
  [key in keyof ReportPreviewVariant]: Array<ReportPreviewVariant[key]>
}



export type ReportPreviewVariantProps = {
  [key in keyof ReportPreviewVariant]?: ConditionalValue<ReportPreviewVariant[key]> | undefined
}

export interface ReportPreviewRecipe {
  
  __type: ReportPreviewVariantProps
  (props?: ReportPreviewVariantProps): string
  raw: (props?: ReportPreviewVariantProps) => ReportPreviewVariantProps
  variantMap: ReportPreviewVariantMap
  variantKeys: Array<keyof ReportPreviewVariant>
  splitVariantProps<Props extends ReportPreviewVariantProps>(props: Props): [ReportPreviewVariantProps, Pretty<DistributiveOmit<Props, keyof ReportPreviewVariantProps>>]
  getVariantProps: (props?: ReportPreviewVariantProps) => ReportPreviewVariantProps
}


export declare const reportPreview: ReportPreviewRecipe