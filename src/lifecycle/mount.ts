import { addStyles } from '../utils/dom'
import { Application, AppStatus } from '../types'
import { isSandboxEnabled, triggerAppHook } from '../utils/application'

export default function mountApp(app: Application): Promise<any> {
    // 准备工作
    triggerAppHook(app, 'beforeMount', AppStatus.BEFORE_MOUNT)
    app.container.setAttribute('single-spa-name', app.name)
    
    // 非首次加载且开通了沙箱隔离功能则恢复快照后开启沙箱
    if (!app.isFirstLoad) {
        if (isSandboxEnabled(app)) {
            // 重新加载子应用时恢复快照
            app.sandbox.restoreWindowSnapshot()
            // 启用沙箱
            app.sandbox.start()
        }
        
        // 再次填充container的innerHTML
        app.container.innerHTML = app.pageBody
        // 子应用首次加载的addStyles行为发生在bootstrap生命周期中
        addStyles(app.styles)
    } else {
        app.isFirstLoad = false
    }
    
    // 执行mounted钩子函数
    const result = (app as any).mount({ props: app.props, container: app.container })

    return Promise.resolve(result)
    .then(() => {
        triggerAppHook(app, 'mounted', AppStatus.MOUNTED)
    })
    .catch((err: Error) => {
        app.status = AppStatus.MOUNT_ERROR
        throw err
    })
}