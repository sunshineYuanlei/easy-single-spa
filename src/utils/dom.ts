import { AnyObject } from '../types'
import { originalWindow } from './originalEnv'

let onEventTypes: string[] = []
export function getEventTypes() {
    if (onEventTypes.length) return onEventTypes

    for (const key of Object.keys(originalWindow)) {
        if (typeof key === 'string' && key.startsWith('on')) {
            onEventTypes.push(key.slice(2))
        }
    }

    return onEventTypes
}

export function createElement(tag: string, attrs?: AnyObject) {
    const node = document.createElement(tag)
    attrs && Object.keys(attrs).forEach(key => {
        node.setAttribute(key, attrs[key])
    })

    return node
}

export function removeNode(node: Node) {
    node.parentNode?.removeChild(node)
}

const head = document.head
export function addStyles(styles: string[] | HTMLStyleElement[]) {
    styles.forEach(item => {
        if (typeof item === 'string') {
            // 调用patchDocument中的createElement, 给style添加`style[single-spa-name=${name}]`
            const node = createElement('style', {
                type: 'text/css',
                textContent: item,
            })
            // node.tagName === 'STYLE'
            // 调用patchDocument中的appendChild, node.tagName === 'STYLE', addCSSScope
            head.appendChild(node)
        } else {
            // item.rel === 'stylesheet'
            // 调用patchDocument中的appendChild, node.rel === 'stylesheet', 实际操作同上
            head.appendChild(item)
        }
    })
}

export function removeStyles(name: string) {
    const styles = document.querySelectorAll(`style[single-spa-name=${name}]`)
   
    styles.forEach(style => {
        removeNode(style)
    })
    
    console.log('styles>>>', styles)
    return styles as unknown as HTMLStyleElement[]
}

// unique element
export function isUniqueElement(key: string): boolean {
    return /^body$/i.test(key) || /^head$/i.test(key) || /^html$/i.test(key)
}
