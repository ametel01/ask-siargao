import { memo, splitProps } from '../helpers.mjs';
import { createRecipe, mergeRecipes } from './create-recipe.mjs';

const sectionPanelFn = /* @__PURE__ */ createRecipe('section-panel', {}, [])

const sectionPanelVariantMap = {}

const sectionPanelVariantKeys = Object.keys(sectionPanelVariantMap)

export const sectionPanel = /* @__PURE__ */ Object.assign(memo(sectionPanelFn.recipeFn), {
  __recipe__: true,
  __name__: 'sectionPanel',
  __getCompoundVariantCss__: sectionPanelFn.__getCompoundVariantCss__,
  raw: (props) => props,
  variantKeys: sectionPanelVariantKeys,
  variantMap: sectionPanelVariantMap,
  merge(recipe) {
    return mergeRecipes(this, recipe)
  },
  splitVariantProps(props) {
    return splitProps(props, sectionPanelVariantKeys)
  },
  getVariantProps: sectionPanelFn.getVariantProps,
})