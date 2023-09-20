import addCSSScope from '../sandbox/addCSSScope'
import { Application, Source } from '../types'
import { createElement, removeNode } from './dom'
import { originalAppendChild, originalWindow } from './originalEnv'
import { isFunction } from './utils'

const urlReg = /^http(s)?:\/\//
 
function isCorrectURL(url = '') {
    return urlReg.test(url)
}

export const globalLoadedURLs: string[] = []

// 解析html并加载js和css资源
export function parseHTMLandLoadSources(app: Application) {
    // eslint-disable-next-line no-async-promise-executor
    return new Promise<void>(async (resolve, reject) => {
        // 可行性校验
        const pageEntry = app.pageEntry
        if (!isCorrectURL(pageEntry)) {
            return reject(Error(`${pageEntry} is not a valid url`))
        }
        
        // 根据pageEntry加载html
        let html = ''
        try {
            // 根据pageEntry请求获取响应返回的html字符串
            html = await loadSourceText(pageEntry) // load html
        } catch (error) {
            // 已经是Error类型了, 不需要再次包装
            reject(error)
        }
        
        // 将html转换成字符串后提取scripts和styles, 并剔除之
        const domparser = new DOMParser()
        const doc = domparser.parseFromString(html, 'text/html')
        const { scripts, styles } = extractScriptsAndStyles(doc as unknown as Element, app)
        
        // 填充app.pageBody给到bootstrap和mount生命周期钩子函数中填充app.container.innerHTML
        app.pageBody = doc.body.innerHTML

        let isStylesDone = false, isScriptsDone = false
        // 加载 style script 的内容
        Promise.all(loadStyles(styles))
        .then(data => {
            app.styles = data as string[]

            isStylesDone = true
            if (isScriptsDone && isStylesDone) resolve()
        })
        .catch(err => reject(err))

        Promise.all(loadScripts(scripts))
        .then(data => {
            app.scripts = data as string[]

            isScriptsDone = true
            if (isScriptsDone && isStylesDone) resolve()
        })
        .catch(err => reject(err))
    })
}

// 解析document, 提取其中的scripts和styles打包返回并执行和删除之
function extractScriptsAndStyles(node: Element, app: Application) {
    if (!node.children.length) return { scripts: [], styles: [] }

    let styles: Source[] = []
    let scripts: Source[] = []
    for (const child of Array.from(node.children)) {
        // 获取style和script资源的global属性标记值
        const isGlobal = Boolean(child.getAttribute('global'))
        // 获取标签名称
        const tagName = child.tagName
        
        if (tagName === 'STYLE') {
            removeNode(child)
            // style处理比较简单, 因为没有src
            styles.push({
                isGlobal,
                value: child.textContent || '',
            })
        } else if (tagName === 'SCRIPT') {
            removeNode(child)
            
            const src = child.getAttribute('src') || ''

            // 已处理则不做处理
            if (app.loadedURLs.includes(src) || globalLoadedURLs.includes(src)) {
                continue
            }
            
            // 没有处理, 则填充app.scripts, 里面每一项都是对应的script配置项
            // 基础配置
            const config: Source = {
                isGlobal,
                type: child.getAttribute('type'),
                value: child.textContent || '',
            }
            
            if (src) {
                // 补充url配置
                config.url = src
                // 打点标记已处理
                if (isGlobal) {
                    globalLoadedURLs.push(src)
                } else {
                    app.loadedURLs.push(src)  
                }
            }

            scripts.push(config)
        } else if (tagName === 'LINK') {
            removeNode(child)

            const href = child.getAttribute('href') || ''

            // 已处理则不做处理
            if (app.loadedURLs.includes(href) || globalLoadedURLs.includes(href)) {
                continue
            }
            
            // 再加一层层叠样式表判断
            if (child.getAttribute('rel') === 'stylesheet' && href) {
                styles.push({
                    url: href,
                    isGlobal,
                    value: '',
                })
                
                // 打点标记
                if (isGlobal) {
                    globalLoadedURLs.push(href)
                } else {
                    app.loadedURLs.push(href)
                }
            }
        } else {
            // 递归处理填充scripts和styles
            const result = extractScriptsAndStyles(child, app)
            scripts = scripts.concat(result.scripts)
            styles = styles.concat(result.styles)
        }
    }
   
    return { scripts, styles }
}

export function loadSourceText(url: string) {
    // 使用promise做一个资源加载的包装
    return new Promise<string>((resolve, reject) => {
        // 实例化一个xhr对象
        const xhr = new XMLHttpRequest()
        
        // 事件绑定
        xhr.onload = (res: any) => {
            resolve(res.target.response)
        }
        xhr.onerror = reject
        xhr.onabort = reject

        // 准备get
        xhr.open('get', url)
        // 发送请求
        xhr.send()
    })
}

const head = document.head
function loadStyles(styles: Source[]) {
    if (!styles.length) return []

    return styles.map(item => {
        if (item.isGlobal) {
            if (item.url) {
                const link = createElement('link', {
                    global: item.isGlobal,
                    href: item.url,
                    rel: 'stylesheet',
                })

                originalAppendChild.call(head, link)
            } else {
                const style = createElement('style', {
                    global: item.isGlobal,
                    type: 'text/css',
                    textContent: item.value,
                })
                
                // 安全模式
                originalAppendChild.call(head, style)
            }

            return
        }

        if (item.url) return loadSourceText(item.url)
        return Promise.resolve(item.value)
    })
    .filter(Boolean)
}

function loadScripts(scripts: Source[]) {
    // 边界情况处理, 直接返回[], 亦即Promise.all([]).then(res => {...}), then中的res为[]
    if (!scripts.length) return []
    return scripts.map(item => {
        // 挂载全局脚本
        const type = item.type || 'text/javascript'
        if (item.isGlobal) {
            const script = createElement('script', { 
                type,
                global: item.isGlobal,
            })

            if (item.url) {
                script.setAttribute('src', item.url)
            } else {
                script.textContent = item.value
            }

            originalAppendChild.call(head, script)
            return
        }
        
        if (item.url) return loadSourceText(item.url)
        // 添加item.value到app.scripts中
        return Promise.resolve(item.value)
    })
    .filter(Boolean)
}

export function executeScripts(scripts: string[], app: Application) {
    try {
        scripts.forEach(code => {
            // 如果子应用提供了 loader, 则处理之
            if (isFunction(app.loader)) {
                // @ts-ignore
                code = app.loader(code)
            }
            
            // 核心
            if (app.sandboxConfig?.enabled) {
                // !
                // ts 使用 with 会报错，所以需要这样包一下
                // 将子应用的 js 代码全局 window 环境指向代理环境 proxyWindow
                const warpCode = `
                    ;(function(proxyWindow){
                        with (proxyWindow) {
                            (function(window){${code}\n}).call(proxyWindow, proxyWindow)
                        }
                    })(this);
                `

                new Function(warpCode).call(app.sandbox.proxyWindow)
            } else {
                new Function('window', code).call(originalWindow, originalWindow)
            }
        })
    } catch (error) {
        throw error
    }
}

export async function fetchStyleAndReplaceStyleContent(style: HTMLStyleElement, url: string, app: Application) {
    const content = await loadSourceText(url)
    style.textContent = content
    if (app.sandboxConfig?.css) {
        // 样式隔离
        addCSSScope(style, app)
    }
}

export async function fetchScriptAndExecute(url: string, app: Application) {
    const content = await loadSourceText(url)
    executeScripts([content], app)
}
