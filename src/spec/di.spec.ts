import 'source-map-support/register';
import * as Bluebird from 'bluebird';
import { Di } from '../di';
import ObjectWrapper from '../object-wrapper';

let inject = Di.inject;

class Foo {
  constructor() { }
}

class Bar {
  constructor(@inject public foo: Foo) { }
}

class FooFoo {
  constructor(@inject private scopeContext: Di.ScopeContext) { }
  getFooField() {
    return this.scopeContext.get('fooField');
  }
}

class Resource {
  private _state = 'initial';
  get state(): string { return this._state; }
  async acquire() {
    this._state = 'acquired';
    return this;
  }
  release() {
    this._state = 'released';
  }
}

class UninjectableClass {
}

class Baz {
  constructor(@inject public resource: Resource) { }
}

class BazBaz {
  constructor(@inject public resource: Resource) { }
}

class Koo {
  constructor(@inject public value: UninjectableClass) { }
}

function disposerFactory(resource) {
  return Bluebird.resolve(resource.acquire())
    .disposer(() => {
      resource.release();
    });
}

class FooWrapper extends ObjectWrapper<Foo> {
  initialize() {
    this.object = new Foo();
  }
}

class TestScopeMethod {
  @Di.scope
  method(s: string, @inject foo?: Foo, @inject(Bar) bar?) {
    return {foo, bar};
  }
}

describe('container', () => {
  let container = Di.container;

  beforeAll(() => {
    container
      .bindTransientClass(Foo)
      .bindTransientClass(Bar)
      .bindTransientClass(Baz)
      .bindTransientClass(FooFoo)
      .bindTransientClass(BazBaz)
      .bindTransientClass(Koo)
      .bindScopeResource(Resource, disposerFactory)
      .bindConstant(UninjectableClass, new UninjectableClass())
      .bindObjectWrapper(FooWrapper);
  });

  it(`should inject an instance of registered class`, async (done) => {
    await container
      .scope()
      .inject(Foo)
      .run((foo: Foo) => {
        expect(foo).toEqual(jasmine.any(Foo));
      });
    done();
  });

  it(`should inject an instance with dependency resolved`, async (done) => {
    await container
      .scope()
      .inject(Bar)
      .run((bar: Bar) => {
        expect(bar.foo).toEqual(jasmine.any(Foo));
      });
    done();
  });

  it(`should inject ScopeContext`, async (done) => {
    await container
      .scope()
      .inject(FooFoo, Di.ScopeContext)
      .run((foofoo: FooFoo, context: Di.ScopeContext) => {
        const fooObject = {};
        context.setOnce('fooField', fooObject);
        expect(foofoo.getFooField()).toBe(fooObject);
      });
    done();
  });

  it(`should acquire and release resource`, async (done) => {
    let resource;
    await container
      .scope()
      .inject(Baz)
      .run(baz => {
        expect(baz.resource.state).toBe('acquired');
        resource = baz.resource;
      });
    expect(resource.state).toBe('released');
    done();
  });

  it(`should inject same resource in the scope`, async (done) => {
    await container
      .scope()
      .inject(Baz, BazBaz)
      .run((baz, bazBaz) => {
        expect(baz.resource).toBe(bazBaz.resource);
      });
    done();
  });

  it(`should inject different resource out of the scope`, async (done) => {
    let resource;
    await container
      .scope()
      .inject(Baz)
      .run(baz => {
        resource = baz.resource;
      });
    await container
      .scope()
      .inject(Baz)
      .run(baz => {
        expect(baz.resource).not.toBe(resource);
      });
    done();
  });

  it(`should inject value`, async (done) => {
    let value;
    await container
      .scope()
      .inject(Koo)
      .run(koo => {
        expect(koo.value).toEqual(jasmine.any(UninjectableClass));
        value = koo.value;
      });
    await container
      .scope()
      .inject(UninjectableClass)
      .run(obj => {
        expect(obj).toBe(value);
      });
    done();
  });

  it(`should inject ObjectWrapper.object`, async (done) => {
    await container
      .scope()
      .inject(FooWrapper)
      .run(foo => {
        expect(foo).toEqual(jasmine.any(Foo));
      });
    done();
  });

  it(`should provide scope and inject using decorator`, async (done) => {
    let obj = new TestScopeMethod();
    let {foo, bar} = await obj.method('a');
    expect(foo).toEqual(jasmine.any(Foo));
    expect(bar).toEqual(jasmine.any(Bar));
    done();
  });
});
