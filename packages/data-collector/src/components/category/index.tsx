import type { PromptFactory, ReactFactoryContext } from '@eyra/feldspar'
import { CategoryCard } from './component'
import { isPropsUIPromptCategory } from './types'

export class CategoryFactory implements PromptFactory {
  create (body: unknown, context: ReactFactoryContext) {
    return isPropsUIPromptCategory(body) ? <CategoryCard {...body} {...context} /> : null
  }
}
