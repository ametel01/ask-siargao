import { memo, splitProps } from '../helpers.mjs';
import { createRecipe, mergeRecipes } from './create-recipe.mjs';

const riskGaugeFn = /* @__PURE__ */ createRecipe('risk-gauge', {}, [])

const riskGaugeVariantMap = {}

const riskGaugeVariantKeys = Object.keys(riskGaugeVariantMap)

export const riskGauge = /* @__PURE__ */ Object.assign(memo(riskGaugeFn.recipeFn), {
  __recipe__: true,
  __name__: 'riskGauge',
  __getCompoundVariantCss__: riskGaugeFn.__getCompoundVariantCss__,
  raw: (props) => props,
  variantKeys: riskGaugeVariantKeys,
  variantMap: riskGaugeVariantMap,
  merge(recipe) {
    return mergeRecipes(this, recipe)
  },
  splitVariantProps(props) {
    return splitProps(props, riskGaugeVariantKeys)
  },
  getVariantProps: riskGaugeFn.getVariantProps,
})