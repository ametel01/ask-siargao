import { memo, splitProps } from '../helpers.mjs';
import { createRecipe, mergeRecipes } from './create-recipe.mjs';

const reportPreviewFn = /* @__PURE__ */ createRecipe('report-preview', {}, [])

const reportPreviewVariantMap = {}

const reportPreviewVariantKeys = Object.keys(reportPreviewVariantMap)

export const reportPreview = /* @__PURE__ */ Object.assign(memo(reportPreviewFn.recipeFn), {
  __recipe__: true,
  __name__: 'reportPreview',
  __getCompoundVariantCss__: reportPreviewFn.__getCompoundVariantCss__,
  raw: (props) => props,
  variantKeys: reportPreviewVariantKeys,
  variantMap: reportPreviewVariantMap,
  merge(recipe) {
    return mergeRecipes(this, recipe)
  },
  splitVariantProps(props) {
    return splitProps(props, reportPreviewVariantKeys)
  },
  getVariantProps: reportPreviewFn.getVariantProps,
})