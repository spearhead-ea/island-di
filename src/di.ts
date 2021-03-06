import 'reflect-metadata';
import * as Promise from 'bluebird';
import { logger } from './logger';
import * as _ from 'lodash';
import * as inversify from 'inversify';
import ObjectFactory from './object-factory';
import  { default as ObjectWrapper } from './object-wrapper';

export { ObjectWrapper, ObjectFactory };

export namespace Di {
  const MetadataKeys = {
    InversifyParamTypes: 'invesify:paramtypes',
    DesignParamTypes: 'design:paramtypes',
    IslandInjectionTag: 'island:injectiontag'
  };

  export interface DisposerFactory<T> {
    (resource: T): Promise.Disposer<T>;
  }

  export interface ScopeResource {
    constructor: new (...args) => any;
    disposerFactory: DisposerFactory<any>;
  }

  export class Container {
    private kernel: inversify.interfaces.Container;
    private scopeResources: ScopeResource[] = [];
    private boundConstants: InjectionIdentifier<any>[] = [];

    constructor() {
      this.kernel = new inversify.Container();
    }

    bindTransientClass(aClass: new (...args) => any, bClass?: new (...args) => any): Container {
      // hack?: override some transient class. for unittest.
      bClass = bClass || aClass;
      if (this.kernel.isBound(aClass)) {
        logger.debug(`rebind transientClass for test, from: ${aClass.name || aClass} to: ${bClass.name || bClass}`);
        this.kernel.unbind(aClass);
      }
      this.decorateInjectable(bClass);
      this.kernel.bind(aClass).to(bClass);
      return this;
    }

    bindScopeResource<T>(aClass: new (...args) => T, disposerFactory: DisposerFactory<T>): Container {
      this.decorateInjectable(aClass);
      this.scopeResources.push({constructor: aClass, disposerFactory});
      return this;
    }

    private decorateInjectable(aClass: new (...args) => any): void {
      try {
        inversify.decorate((target: any) => {
          // little hack: using unexported metadata
          // @see https://github.com/inversify/InversifyJS/blob/master/src/annotation/injectable.ts
          if (Reflect.hasOwnMetadata(MetadataKeys.InversifyParamTypes, target) === true) {
            return;
          }
          return inversify.injectable()(target);
        }, aClass);
      } catch (e) {
        logger.debug(`decorate injectable reports error. can ignore. ${e}`);
      }
    }

    getConstantValue<T>(identifier: InjectionIdentifier<any>): T {
      return this.kernel.get(identifier);
    }

    getConstantIdentifierList(): InjectionIdentifier<any>[] {
      return this.boundConstants;
    }

    bindConstant(identifier: InjectionIdentifier<any>, value: any): Container {
      // hack?: override some constant. for unittest.
      if (this.kernel.isBound(identifier)) {
        logger.debug(`rebind constant for test, ${(identifier as any).name || identifier}`);
        this.kernel.unbind(identifier);
      }
      this.kernel.bind(identifier).toConstantValue(value);
      this.boundConstants.push(identifier);
      return this;
    }

    bindObjectWrapper(aClass: new (...args) => any): Container {
      this.kernel.bind(aClass as any).toDynamicValue(() => ObjectFactory.get(aClass as any));
      return this;
    }

    scope(): Scope {
      return new Scope(this.kernel, this.scopeResources);
    }
  }

  export type InjectionIdentifier<T> = string | (new (...args: any[]) => T);

  export class Scope {
    private kernel: inversify.interfaces.Container;
    private objToBindScopeContext: {[name: string]: any};
    private injections: InjectionIdentifier<any>[] = [];
    private disposers: {[name: string]: Promise.Disposer<any>} = {};

    constructor(kernel,
                private scopeResources: ScopeResource[]) {
      this.kernel = kernel;
    }

    context(contextToBind: {[name: string]: any}): Scope {
      this.objToBindScopeContext = contextToBind;
      return this;
    }

    inject(...args: InjectionIdentifier<any>[]): Scope {
      this.injections = args;
      return this;
    }

    run<R>(task: (...args: any[]) => Promise<R> | R): Promise<R> {
      this.kernel.snapshot();
      this.bindScopeContext();
      this.bindScopeResources();
      let injectedObjects = this.injectScopeParameters();
      this.kernel.restore();

      let disposerArray = _.map(this.disposers, disposer => disposer);
      return Promise.using(disposerArray, () => {
        return Promise.resolve<R>(task.apply(null, injectedObjects));
      });
    }

    private bindScopeContext(): void {
      this.kernel
        .bind(ScopeContext)
        .to(ScopeContext)
        .inSingletonScope();

      if (this.objToBindScopeContext) {
        let scopeContext = this.kernel.get(ScopeContext);
        _.forEach(this.objToBindScopeContext, (value, name) => {
          scopeContext.setOnce(name, value);
        });
      }
    }

    private bindScopeResources(): void {
      this.scopeResources.forEach(resource => {
        const name = inversify.getServiceIdentifierAsString(resource.constructor);
        const instanceBindName = name + '@instance';

        this.kernel
          .bind(instanceBindName)
          .to(resource.constructor)
          .inSingletonScope();

        this.kernel
          .bind(resource.constructor)
          .toDynamicValue(() => {
            let instance = this.kernel.get(instanceBindName);
            if (!this.disposers[name]) {
              this.disposers[name] = resource.disposerFactory(instance);
            }
            return instance;
          });
      });
    }

    private injectScopeParameters(): any[] {
      return this.injections.map(identifier => this.kernel.get(identifier));
    }
  }

  @inversify.injectable()
  export class ScopeContext {
    private context: {[name: string]: any} = {};

    setOnce(name: string, value: any): ScopeContext {
      if (this.context.hasOwnProperty(name)) {
        throw new Error(`${name} is supposed to be set only once`);
      }
      this.context[name] = value;
      return this;
    }

    get<T>(name: string): T {
      if (!this.context.hasOwnProperty(name)) {
        throw new Error(`${name} was not set`);
      }
      return this.context[name] as T;
    }
  }

  export function inject(target: any, key?: string, index?: number): any {
    if (typeof index === 'number') {
      return inject(getParamType(target, key, index), key)(target, key, index);
    }
    return injectDecoratorFactory(target);
  }

  function getParamType(target: any, key: string, index: number): any {
    if (!Reflect.hasOwnMetadata(MetadataKeys.DesignParamTypes, target, key)) {
      throw new Error('error on collecting metadata. check compiler option emitDecoratorMetadata is true');
    }
    let paramTypes = Reflect.getMetadata(MetadataKeys.DesignParamTypes, target, key);
    return paramTypes[index];
  }

  function injectDecoratorFactory(id: InjectionIdentifier<any>) {
    return (target: any, key: string, index: number) => {
      if (key === undefined) {
        return inversify.inject(id)(target, key, index);
      }
      let injectionTags = Reflect.getOwnMetadata(MetadataKeys.IslandInjectionTag, target, key) || [];
      injectionTags.push({index, id});
      Reflect.defineMetadata(MetadataKeys.IslandInjectionTag, injectionTags, target, key);
    };
  }

  export function scope(target: any, name: string, descriptor: PropertyDescriptor): any {
    const oldDescriptorValue = descriptor.value;
    let method = descriptor.value;
    descriptor.value = function (...args: any[]) {
      let injectionTags = Reflect.getOwnMetadata(MetadataKeys.IslandInjectionTag, target, name) || [];
      return container.scope()
        .inject(...injectionTags.map(tag => tag.id))
        .run((...injectedObjects: any[]) => {
          injectionTags.forEach((tag, i) => {
            if (args[tag.index] !== undefined) {
              logger.debug(`override parameter[${tag.index}] by ${tag.id}`);
            }
            args[tag.index] = injectedObjects[i];
          });
          return method.apply(this, args);
        });
    };

    Object.keys(oldDescriptorValue).forEach((key) => {
      descriptor.value[key] = oldDescriptorValue[key];
    })
  }

  export function bindTransientClass(aClass: new (...args) => any) {
    container.bindTransientClass(aClass);
  }

  export var container = new Di.Container();
}
