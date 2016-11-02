import ObjectWrapper from './object-wrapper';

/**
 * ModelFactory
 * @class
 */
export default class ObjectFactory {
  private static models: { [name: string]: any } = {};

  /**
   * Retrieves the wrapped object of given wrapper.
   * @param {typeof ObjectWrapper} Class
   * @returns {T}
   */
  public static get<T>(Class: typeof ObjectWrapper) {
    var name: string = (<any>Class.prototype.constructor).name;
    var instance = <ObjectWrapper<T>>this.models[name];
    if (!instance) {
      this.models[name] = instance = new Class<T>();
      instance.initialize();
      instance.onInitialized();
      return instance.Object;
    }
    return instance.Object;
  }
}