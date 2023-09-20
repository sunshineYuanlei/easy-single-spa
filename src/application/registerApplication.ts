import { Application, AppStatus } from '../types'
import { appMaps } from '../utils/application'

export default function registerApplication(app: Application) {
    // 1、适配子应用激活规则(app.activeRule)
    if (typeof app.activeRule === 'string') {
        const path = app.activeRule
        app.activeRule = (location = window.location) => location.pathname === path
    }

    // 2、给应用加点料(app配置初始化)
    app = {
        ...app,
        status: AppStatus.BEFORE_BOOTSTRAP,
        pageBody: '',
        loadedURLs: [],
        scripts: [],
        styles: [],
        isFirstLoad: true,
    }

    // 3、特别地,给子应用的沙箱配置一个默认值
    if (!app.sandboxConfig) {
        app.sandboxConfig = {
            enabled: true,
            css: false,
        }
    }

    // 以上三步可以随意乱序

    // 注册子应用
    appMaps.set(app.name, app)
}
