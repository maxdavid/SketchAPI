import { toArray } from 'util'
import { Document } from './models/Document'
import { wrapObject } from './wrapNativeObject'
import { Types } from './enums'
import { Factory } from './Factory'

const simpleAttribute = (attribute, opposite) => (
  operator,
  value,
  { addPredicatePart, addPredicateVar }
) => {
  addPredicatePart(`${opposite ? '!' : ''}(%K ${operator} %@)`)
  addPredicateVar(attribute)
  addPredicateVar(value)
}

const attributesMap = {
  name: simpleAttribute('name'),
  id: simpleAttribute('objectID'),
  frame: simpleAttribute('frame'),
  'frame.x': simpleAttribute('frame.x'),
  'frame.y': simpleAttribute('frame.y'),
  'frame.width': simpleAttribute('frame.width'),
  'frame.height': simpleAttribute('frame.height'),
  locked: simpleAttribute('isLocked'),
  hidden: simpleAttribute('isVisible', true),
  selected: simpleAttribute('isSelected'),
  type(operator, value, { addPredicatePart, addPredicateVar }) {
    const opposite = operator === '!='
    if (opposite) {
      // eslint-disable-next-line no-param-reassign
      operator = '='
    }
    const predicate = []
    const nativeClasses = Factory._typeToNative[value]
    if (!nativeClasses) {
      throw new Error(`Unknown layer type ${value}`)
    }
    nativeClasses.forEach(c => {
      predicate.push(`className ${operator} %@`)
      addPredicateVar(String(c))
    })

    addPredicatePart(`${opposite ? '!' : ''}(${predicate.join(' OR ')})`)
  },
}

const operatorMap = {
  '=': '=',
  '*=': 'CONTAINS',
  '$=': 'ENDSWITH',
  '!=': '!=',
  '^=': 'BEGINSWITH',
  '>=': '>=',
  '=<': '=<',
  '>': '>',
  '<': '<',
}

// taken from https://github.com/jquery/sizzle/blob/master/src/sizzle.js
const whitespace = '\\s'
const identifier = '(?:\\\\.|[\\w-]|[^\0-\\xa0])+'
const attributes = `\\[${whitespace}*(${identifier})(?:${whitespace}*([*^$|!~]?=)${whitespace}*(?:'((?:\\\\.|[^\\\\'])*)'|"((?:\\\\.|[^\\\\"])*)"|(${identifier}))|)${whitespace}*\\]`
const booleans = 'locked|hidden|selected'

const matchExpr = {
  ID: new RegExp(`^#(${identifier})`),
  TYPE: new RegExp(`^(${identifier}|[*])`),
  ATTR: new RegExp(`^${attributes}`),
  bool: new RegExp(`^(?::(not-)?(${booleans}))$`, 'i'),
}

function parseValue(value) {
  if (value === 'true') {
    return true
  }
  if (value === 'false') {
    return false
  }
  return Number(value)
}

export function find(predicate, root) {
  if (!root) {
    // eslint-disable-next-line no-param-reassign
    root = Document.getSelectedDocument()
  }
  // eslint-disable-next-line no-param-reassign
  root = wrapObject(root)
  // eslint-disable-next-line no-param-reassign
  predicate = String(predicate || '').trim()

  if (!predicate) {
    return []
  }

  const predicateParts = predicate
    .split(/,/g)
    .map(x => x.trim())
    .filter(x => x)

  const nativePredicateParts = []
  const predicateVars = []

  const mutations = {
    addPredicatePart(x) {
      nativePredicateParts.push(x)
    },
    addPredicateVar(x) {
      predicateVars.push(x)
    },
  }

  predicateParts.forEach(part => {
    let matched = false
    Object.keys(matchExpr).forEach(k => {
      const match = matchExpr[k].exec(part)

      if (!match) {
        return
      }

      if (k === 'ID') {
        attributesMap.id('=', match[1], mutations)
        matched = true
      }

      if (k === 'TYPE') {
        if (match[1] === '*') {
          nativePredicateParts.push('TRUEPREDICATE')
        } else {
          attributesMap.type('=', match[1], mutations)
        }
        matched = true
      }

      if (k === 'ATTR') {
        const operator = operatorMap[match[2]]
        if (!operator) {
          throw new Error(`unknown operator ${match[2]}`)
        }
        const value = match[3] || match[4] || parseValue(match[5])
        const attribute = attributesMap[match[1]]
        if (!attribute) {
          throw new Error(`unknown attribute ${match[1]}`)
        }
        attribute(operator, value, mutations)
        matched = true
      }

      if (k === 'bool') {
        const attribute = attributesMap[match[2]]
        if (!attribute) {
          throw new Error(`unknown attribute ${match[2]}`)
        }
        attribute('=', !match[1], mutations)
        matched = true
      }
    })
    if (!matched) {
      throw new Error(`could not parse predicate ${part}`)
    }
  })

  const nativePredicate = NSPredicate.predicateWithFormat_argumentArray(
    nativePredicateParts.join(' AND '),
    predicateVars
  )

  const children =
    root.type == Types.Document
      ? root.sketchObject.pages().reduce((prev, page) => {
          prev.addObjectsFromArray(page.children())
          return prev
        }, NSMutableArray.new())
      : root.sketchObject.children()

  const matches = children.filteredArrayUsingPredicate(nativePredicate)

  return toArray(matches).map(x => wrapObject(x))
}
