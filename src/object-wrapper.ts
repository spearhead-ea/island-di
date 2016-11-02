export default class ObjectWrapper<T> {
  protected object: T
  public get Object() {
    if (!this.object) throw new Error('Not initialized exception');
    return this.object;
  }

  public initialize() {
    throw new Error('Not implemented exception');
  }

  public onInitialized() {}
}