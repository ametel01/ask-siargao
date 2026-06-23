import { memo, splitProps } from '../helpers.mjs';
import { createRecipe, mergeRecipes } from './create-recipe.mjs';

const faqAccordionFn = /* @__PURE__ */ createRecipe('faq-accordion', {}, [])

const faqAccordionVariantMap = {}

const faqAccordionVariantKeys = Object.keys(faqAccordionVariantMap)

export const faqAccordion = /* @__PURE__ */ Object.assign(memo(faqAccordionFn.recipeFn), {
  __recipe__: true,
  __name__: 'faqAccordion',
  __getCompoundVariantCss__: faqAccordionFn.__getCompoundVariantCss__,
  raw: (props) => props,
  variantKeys: faqAccordionVariantKeys,
  variantMap: faqAccordionVariantMap,
  merge(recipe) {
    return mergeRecipes(this, recipe)
  },
  splitVariantProps(props) {
    return splitProps(props, faqAccordionVariantKeys)
  },
  getVariantProps: faqAccordionFn.getVariantProps,
})