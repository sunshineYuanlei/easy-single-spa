import { appMaps, isActive } from '../utils/application'
import bootstrapApp from '../lifecycle/bootstrap'
import mountApp from '../lifecycle/mount'
import unMountApp from '../lifecycle/unmount'
import { Application, AppStatus } from '../types'

export async function loadApps() {
    const toLoadApp = getAppsWithStatus(AppStatus.BEFORE_BOOTSTRAP)
    const toUnMountApp = getAppsWithStatus(AppStatus.MOUNTED)

    // 卸载所有子应用, 并初始化所有(刚注册的)子应用
    const loadPromise = toLoadApp.map(bootstrapApp)
    const unMountPromise = toUnMountApp.map(unMountApp)
    await Promise.all([...loadPromise, ...unMountPromise])

    // 加载所有符合条件的子应用, 同时预加载其它UNMOUNTED的子应用
    const toMountApp = [
        ...getAppsWithStatus(AppStatus.BOOTSTRAPPED),
        ...getAppsWithStatus(AppStatus.UNMOUNTED),
    ]
    
    // 注意此处的用法
    await toMountApp.map(mountApp)
}

function getAppsWithStatus(status: AppStatus) {
    const result: Application[] = []
    appMaps.forEach((app) => {
    // 如果 app 路由规则匹配 to bootstrap or to mount
        if (isActive(app) && app.status === status) {
            switch (app.status) {
                case AppStatus.BEFORE_BOOTSTRAP:
                case AppStatus.BOOTSTRAPPED:
                case AppStatus.UNMOUNTED:
                    result.push(app)
                    break
            }
        } else if (
            app.status === AppStatus.MOUNTED
      && status === AppStatus.MOUNTED
        ) {
            // 如果路由规则不匹配 to unmount
            result.push(app)
        }
    })

    return result
}
