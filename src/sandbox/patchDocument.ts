import { isUniqueElement } from '../utils/dom'
import { getApp, getCurrentApp, getCurrentAppName, setCurrentAppName } from '../utils/application'
import { executeScripts, fetchScriptAndExecute, fetchStyleAndReplaceStyleContent, globalLoadedURLs } from '../utils/source'
import { 
    originalAppendChild,
    originalCreateElement,
    originalDocument,
    originalGetElementById, 
    originalGetElementsByClassName, 
    originalGetElementsByName, 
    originalGetElementsByTagName, 
    originalInsertBefore, 
    originalQuerySelector,
    originalQuerySelectorAll, 
} from '../utils/originalEnv'
import addCSSScope from './addCSSScope'

export function patchDocument() {
    // 1. 针对appendChild和insertBefore做特殊改造
    // 外层入口
    Element.prototype.appendChild = function appendChild<T extends Node>(node: T): any {
        // 样式隔离的容器操作, 发生在bootstrap生命周期中
        // 内层入口
        return patchAddChild(this, node, null, 'append')
    }
    
    // 虽然提供了对应的能力, 实际上并没有用到
    // 外层入口
    Element.prototype.insertBefore = function insertBefore<T extends Node>(newNode: T, referenceNode: Node | null): any {
        // 样式隔离的容器操作, 发生在bootstrap生命周期中
        // 内层入口
        return patchAddChild(this, newNode, referenceNode, 'insert')
    }
    
    // 2. 针对createElement做特殊改造
    // 样式隔离的容器操作, 发生在bootstrap生命周期中
    // 在executeScripts等后续操作中进行打点标记
    // 子应用激活时, 子应用创建每一个元素, 都添加single-spa-name属性, 值为appName
    // 外层入口
    Document.prototype.createElement = function createElement(
        tagName: string,
        options?: ElementCreationOptions,
    ): HTMLElement {
        const element = originalCreateElement.call(this, tagName, options)
       
        const appName = getCurrentAppName()
        
        // 直接标记
        appName && element.setAttribute('single-spa-name', appName)
        
        return element
    }
    // 以上1和2通过不同的路径对元素做了打点标记
    
    // 3. 元素隔离
    // 将所有查询 dom 的范围限制在子应用挂载的 dom 容器上
    Document.prototype.querySelector = function querySelector(this: Document, selector: string) {
        const app = getCurrentApp()
        if (!app || !selector || isUniqueElement(selector)) {
            return originalQuerySelector.call(this, selector)
        }

        return app.container.querySelector(selector)
    }

    Document.prototype.querySelectorAll = function querySelectorAll(this: Document, selector: string) {
        const app = getCurrentApp()
        if (!app || !selector || isUniqueElement(selector)) {
            return originalQuerySelectorAll.call(this, selector)
        }

        return app.container.querySelectorAll(selector)
    }

    Document.prototype.getElementById = function getElementById(id: string) {
        return getElementHelper(this, originalGetElementById, 'querySelector', id, `#${id}`)
    }

    Document.prototype.getElementsByClassName = function getElementsByClassName(className: string) {
        return getElementHelper(this, originalGetElementsByClassName, 'getElementsByClassName', className, className)
    }

    Document.prototype.getElementsByName = function getElementsByName(elementName: string) {
        return getElementHelper(this, originalGetElementsByName, 'querySelectorAll', elementName, `[name=${elementName}]`)
    }

    Document.prototype.getElementsByTagName = function getElementsByTagName(tagName: string) {
        return getElementHelper(this, originalGetElementsByTagName, 'getElementsByTagName', tagName, tagName)
    }
}

function getElementHelper(
    parent: Document, 
    originFunc: Function, 
    funcName: string,
    originSelector: string, 
    newSelector: string,
) {
    const app = getCurrentApp()
    if (!app || !originSelector) {
        return originFunc.call(parent, originSelector)
    }

    return (app.container as any)[funcName](newSelector)
}

// 元素隔离释放
export function releaseDocument() {
    setCurrentAppName(null)
    Document.prototype.createElement = originalCreateElement
    Document.prototype.appendChild = originalAppendChild
    Document.prototype.insertBefore = originalInsertBefore
    Document.prototype.getElementById = originalGetElementById
    Document.prototype.getElementsByClassName = originalGetElementsByClassName
    Document.prototype.getElementsByName = originalGetElementsByName
    Document.prototype.getElementsByTagName = originalGetElementsByTagName
    Document.prototype.querySelector = originalQuerySelector
    Document.prototype.querySelectorAll = originalQuerySelectorAll
}

const head = originalDocument.head
const tags = ['STYLE', 'LINK', 'SCRIPT']

// 主要针对于append和insert这两个操作, referenceNode只在insert时要传Node, 其它情况传null
function patchAddChild(parent: Node, child: any, referenceNode: Node | null, type: 'append' | 'insert') {
    // 如果tagName不在tags范围内, 则直接执行原生行为
    const tagName = child.tagName
    if (!tags.includes(tagName)) {
        return addChild(parent, child, referenceNode, type)
    }
    
    // 另一种执行原生行为的情况
    // 子应用name
    const appName = child.getAttribute('single-spa-name')
    // 子应用配置
    const app = getApp(appName)
    if (!appName || !app) return addChild(parent, child, referenceNode, type)
    
    // 分类处理

    // 所有的 style 都放到 head 下
    if (tagName === 'STYLE') {
        // 沙箱配置
        if (app.sandboxConfig.css) {
            // 样式隔离
            addCSSScope(child, app)
        }

        return addChild(head, child, referenceNode, type)
    }

    if (tagName === 'SCRIPT') {
        const src = child.src
        // 存在没有处理过的src, 则分类处理
        if (
            src
            && !globalLoadedURLs.includes(src)
            && !app?.loadedURLs.includes(src)
        ) {
            // 记录
            if (child.getAttribute('global')) {
                globalLoadedURLs.push(src)
            } else {
                app?.loadedURLs.push(src)
            }
            
            // 获取脚本内容后执行脚本
            fetchScriptAndExecute(src, app)
            // 因为子应用的脚本执行一次之后就会清空, 所以return null
            return null
        }
        
        // 不存在src的情况
        executeScripts([child.textContent as string], app)
        return null
    }
    
    // 同上
    if ( 
        child.rel === 'stylesheet' 
        && child.href
        && !globalLoadedURLs.includes(child.href)
        && !app?.loadedURLs.includes(child.href)
    ) {
        const href = child.href

        // 记录
        if (child.getAttribute('global')) {
            globalLoadedURLs.push(href)
        } else {
            app?.loadedURLs.push(href)
        }
        
        // 创建一个style标签, 远程加载样式内容进行填充, 根据沙箱配置进行处理
        const style = document.createElement('style')
        style.setAttribute('type', 'text/css')
        
        // 样式隔离
        fetchStyleAndReplaceStyleContent(style, href, app)
        
        // 便于mount的时候重新添加子应用样式
        return addChild(head, style, referenceNode, type)
    }
    
    // 其它调用原生行为的情况
    return addChild(parent, child, referenceNode, type)
}

// 针对于append和insert的原生行为
function addChild(parent: Node, child: any, referenceNode: Node | null, type: 'append' | 'insert') {
    if (type === 'append') {
        return originalAppendChild.call(parent, child)
    }

    return originalInsertBefore.call(parent, child, referenceNode)
}