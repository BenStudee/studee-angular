/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {ɵAnimationEngine as AnimationEngine, ɵAnimationRenderer as AnimationRenderer, ɵAnimationRendererFactory as AnimationRendererFactory} from '@angular/animations/browser';
import {inject, NgZone, Renderer2, RendererFactory2, RendererStyleFlags2, RendererType2, ɵAnimationRendererType as AnimationRendererType, ɵChangeDetectionScheduler as ChangeDetectionScheduler, ɵRuntimeError as RuntimeError} from '@angular/core';
import {ɵRuntimeErrorCode as RuntimeErrorCode} from '@angular/platform-browser';

const ANIMATION_PREFIX = '@';

export class AsyncAnimationRendererFactory implements RendererFactory2 {
  private _rendererFactoryPromise: Promise<AnimationRendererFactory>|null = null;
  private readonly scheduler = inject(ChangeDetectionScheduler, {optional: true});

  /**
   *
   * @param moduleImpl allows to provide a mock implmentation (or will load the animation module)
   */
  constructor(
      private doc: Document, private delegate: RendererFactory2, private zone: NgZone,
      private animationType: 'animations'|'noop', private moduleImpl?: Promise<{
        ɵcreateEngine:
            (type: 'animations'|'noop', doc: Document,
             scheduler: ChangeDetectionScheduler|null) => AnimationEngine,
        ɵAnimationRendererFactory: typeof AnimationRendererFactory
      }>) {}

  /**
   * @internal
   */
  private loadImpl(): Promise<AnimationRendererFactory> {
    const moduleImpl = this.moduleImpl ?? import('@angular/animations/browser');

    return moduleImpl
        .catch((e) => {
          throw new RuntimeError(
              RuntimeErrorCode.ANIMATION_RENDERER_ASYNC_LOADING_FAILURE,
              (typeof ngDevMode === 'undefined' || ngDevMode) &&
                  'Async loading for animations package was ' +
                      'enabled, but loading failed. Angular falls back to using regular rendering. ' +
                      'No animations will be displayed and their styles won\'t be applied.');
        })
        .then(({ɵcreateEngine, ɵAnimationRendererFactory}) => {
          // We can't create the renderer yet because we might need the hostElement and the type
          // Both are provided in createRenderer().
          const engine = ɵcreateEngine(this.animationType, this.doc, this.scheduler);
          const rendererFactory = new ɵAnimationRendererFactory(this.delegate, engine, this.zone);
          this.delegate = rendererFactory;
          return rendererFactory;
        });
  }

  /**
   * This method is delegating the renderer creation to the factories.
   * It uses default factory while the animation factory isn't loaded
   * and will rely on the animation factory once it is loaded.
   *
   * Calling this method will trigger as side effect the loading of the animation module
   * if the renderered component uses animations.
   */
  createRenderer(hostElement: any, rendererType: RendererType2): Renderer2 {
    const renderer = this.delegate.createRenderer(hostElement, rendererType);

    if ((renderer as AnimationRenderer).ɵtype === AnimationRendererType.Regular) {
      // The factory is already loaded, this is an animation renderer
      return renderer;
    }

    // We need to prevent the DomRenderer to throw an error because of synthetic properties
    if (typeof (renderer as any).throwOnSyntheticProps === 'boolean') {
      (renderer as any).throwOnSyntheticProps = false;
    }

    // Using a dynamic renderer to switch the renderer implementation once the module is loaded.
    const dynamicRenderer = new DynamicDelegationRenderer(renderer);

    // Kick off the module loading if the component uses animations but the module hasn't been
    // loaded yet.
    if (rendererType?.data?.['animation'] && !this._rendererFactoryPromise) {
      this._rendererFactoryPromise = this.loadImpl();
    }

    this._rendererFactoryPromise
        ?.then((animationRendererFactory) => {
          const animationRenderer =
              animationRendererFactory.createRenderer(hostElement, rendererType);
          dynamicRenderer.use(animationRenderer);
        })
        .catch(e => {
          // Permanently use regular renderer when loading fails.
          dynamicRenderer.use(renderer);
        });

    return dynamicRenderer;
  }

  begin(): void {
    this.delegate.begin?.();
  }

  end(): void {
    this.delegate.end?.();
  }

  whenRenderingDone?(): Promise<any> {
    return this.delegate.whenRenderingDone?.() ?? Promise.resolve();
  }
}

/**
 * The class allows to dynamicly switch between different renderer implementations
 * by changing the delegate renderer.
 */
export class DynamicDelegationRenderer implements Renderer2 {
  // List of callbacks that need to be replayed on the animation renderer once its loaded
  private replay: ((renderer: Renderer2) => void)[]|null = [];
  readonly ɵtype = AnimationRendererType.Delegated;

  constructor(private delegate: Renderer2) {}

  use(impl: Renderer2) {
    this.delegate = impl;

    if (this.replay !== null) {
      // Replay queued actions using the animation renderer to apply
      // all events and properties collected while loading was in progress.
      for (const fn of this.replay) {
        fn(impl);
      }
      // Set to `null` to indicate that the queue was processed
      // and we no longer need to collect events and properties.
      this.replay = null;
    }
  }

  get data(): {[key: string]: any} {
    return this.delegate.data;
  }

  destroy(): void {
    this.replay = null;
    this.delegate.destroy();
  }

  createElement(name: string, namespace?: string|null) {
    return this.delegate.createElement(name, namespace);
  }

  createComment(value: string): void {
    return this.delegate.createComment(value);
  }

  createText(value: string): any {
    return this.delegate.createText(value);
  }

  get destroyNode(): ((node: any) => void)|null {
    return this.delegate.destroyNode;
  }

  appendChild(parent: any, newChild: any): void {
    this.delegate.appendChild(parent, newChild);
  }

  insertBefore(parent: any, newChild: any, refChild: any, isMove?: boolean|undefined): void {
    this.delegate.insertBefore(parent, newChild, refChild, isMove);
  }

  removeChild(parent: any, oldChild: any, isHostElement?: boolean|undefined): void {
    this.delegate.removeChild(parent, oldChild, isHostElement);
  }

  selectRootElement(selectorOrNode: any, preserveContent?: boolean|undefined): any {
    return this.delegate.selectRootElement(selectorOrNode, preserveContent);
  }

  parentNode(node: any): any {
    return this.delegate.parentNode(node);
  }

  nextSibling(node: any): any {
    return this.delegate.nextSibling(node);
  }

  setAttribute(el: any, name: string, value: string, namespace?: string|null|undefined): void {
    this.delegate.setAttribute(el, name, value, namespace);
  }

  removeAttribute(el: any, name: string, namespace?: string|null|undefined): void {
    this.delegate.removeAttribute(el, name, namespace);
  }

  addClass(el: any, name: string): void {
    this.delegate.addClass(el, name);
  }

  removeClass(el: any, name: string): void {
    this.delegate.removeClass(el, name);
  }

  setStyle(el: any, style: string, value: any, flags?: RendererStyleFlags2|undefined): void {
    this.delegate.setStyle(el, style, value, flags);
  }

  removeStyle(el: any, style: string, flags?: RendererStyleFlags2|undefined): void {
    this.delegate.removeStyle(el, style, flags);
  }

  setProperty(el: any, name: string, value: any): void {
    // We need to keep track of animation properties set on default renderer
    // So we can also set them also on the animation renderer
    if (this.shouldReplay(name)) {
      this.replay!.push((renderer: Renderer2) => renderer.setProperty(el, name, value));
    }
    this.delegate.setProperty(el, name, value);
  }

  setValue(node: any, value: string): void {
    this.delegate.setValue(node, value);
  }

  listen(target: any, eventName: string, callback: (event: any) => boolean | void): () => void {
    // We need to keep track of animation events registred by the default renderer
    // So we can also register them against the animation renderer
    if (this.shouldReplay(eventName)) {
      this.replay!.push((renderer: Renderer2) => renderer.listen(target, eventName, callback));
    }
    return this.delegate.listen(target, eventName, callback);
  }

  private shouldReplay(propOrEventName: string): boolean {
    //`null` indicates that we no longer need to collect events and properties
    return this.replay !== null && propOrEventName.startsWith(ANIMATION_PREFIX);
  }
}
