const mapTag = "[object Map]"
const setTag = "[object Set]"
const arrayTag = "[object Array]"
const objectTag = "[object Object]"
const symbolTag = "[object Symbol]"

function isObject(target) {
  return typeof target === 'object'
}

function isSymbol(target){
   return isObject(target) === symbolTag
}

function getTargetType(target) {
  return Object.prototype.toString.call(target)
}

function createObj(target, type) {
  if(type === arrayTag) return []
  if(type === objectTag) return {}

  // 否则是set或者map或者其它引用对象
  return new target.constructor(target)
}

export default function cloneDeep(target, map = new WeakMap()){
  // 边界情况
  if(!target) return target

  // 基础数据
  if(!isObject(target)) return  target

  // 特殊数据
  if(isSymbol()) return Object(Symbol.prototype.valueOf.call(target))
 

  // 引用数据
  const type = getTargetType(target)
  // 创建基础数据结构
  const result = createObj(target,type)

  // 防止循环引用
  if(map.get(target)) return map.get(target)
  map.set(target, result)

  // set
  if(type === setTag){
     for(const value of target){
      result.add(cloneDeep(value, map))
     }
  }

  // map
  if(type === mapTag){
    for(const [key, value] of target){
      result.set(key, cloneDeep(value, map))
     }
  }

  // 对象或数组
  if(type === arrayTag || type === objectTag){
    Object.keys(target).forEach(key=>{
      result[key] = cloneDeep(target[key], map)
    })
  }

  return result
}