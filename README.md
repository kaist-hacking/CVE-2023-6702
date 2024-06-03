# Chrome Renderer 1day RCE via Type Confusion in Async Stack Trace (CVE-2023-6702)

## Summary

This vulnerability allowed a remote attacker to execute arbitrary code inside the Chrome renderer process.

There was an insufficient type check in the async stack trace handling code.
It leads to a type confusion between `FunctionContext` and `NativeContext`, causing illegal access to the `JSGlobalProxy->hash` value.
With heap spraying, the attacker was able to inject a fake async stack frame, and construct the *fakeobj* primitive.
Using the *fakeobj* primitive, the attacker was able to achieve arbitrary code execution in the Chrome renderer process.

You can check [our TyphoonCon 2024 slides](https://kaist-hacking.github.io/pubs/2024/lee:v8-ctf-slides.pdf).

## Vendor / Product / Version

- Google Chrome
- Affected Versions: pre 120.0.6099.109
- Fixed Version: 120.0.6099.109

## Timeline

- 2020-05-13: Bug Introduced - [[Promise.any] Implment async stack traces for Promise.any](https://chromium-review.googlesource.com/c/v8/v8/+/2198983)
- 2023-11-10: Bug Report - [Security: V8 Debug check failed: LAST_TYPE >= value](https://issues.chromium.org/issues/40941600)
- 2023-11-15: Patch - [[promises, async stack traces] Fix the case when the closure has run](https://chromium.googlesource.com/v8/v8/+/bde3d360097607f36cd1d17cbe8412b84eae0a7f)
- 2023-12-12: Advisory - https://chromereleases.googleblog.com/2023/12/stable-channel-update-for-desktop_12.html
- **2024-01-12: v8CTF submission <-- The time we worked on this vulnerability**
- 2024-02-23: Bug report disclosed

## Background

### Async Stack Trace

Asynchronous is one of the most important feature in JavaScript.
In the past, it was difficult to debug asynchronous code with error stack because async functions are not captured in the error stack.
Suspended async functions are stored in the callback queue of the event loop not the call stack, so the error stack does not contain the async function.
To resolve this issue, V8 provides "async stack trace" feature (by default since V8 v7.3) to capture async function in the error stack. ([v8 blog], [v8 docs])

### Promise.all Resolve Element Closure

"Promise.all Resolve Element Closure" is a helper function to resolve the input promises in the `Promise.all` function.
`Promise.all` function takes an array of promises and returns a promise that resolves when all of the input promises are resolved.
"Promise.all Resolve Element Closure" is a resolve handler of each input promise in the `Promise.all` function.
The role of the function is to resolve the input promise and store the fulfillment value in the result array.

There are 2 points to note about the function:
1. It is a intrinsic builtin function and it is not directly accessible from the JavaScript code.
2. The context of the function is used as a marker to check whether the function has been executed or not.
It has `FunctionContext` until it was called, and then it has `NativeContext` after it was called. ([v8 code](https://source.chromium.org/chromium/chromium/src/+/refs/tags/118.0.5993.70:v8/src/builtins/promise-all-element-closure.tq;drc=dd7087c542d519212aa4813136ba83c0f74d4742;l=87))

## The Vulnerability

**Bug class:** Type confusion between `FunctionContext` and `NativeContext`

**Vulnerability details:**

The vulnerability can be triggered by capturing an async stack trace with the already executed "Promise.all Resolve Element Closure" function or similar intrinsic builtin functions.
In this exploit, I used the "Promise.all Resolve Element Closure" function as an example.

When an error is thrown in the JavaScript code, V8 captures the error stack from the stack and appends the async stack frames from the current microtask 
[[1](https://source.chromium.org/chromium/chromium/src/+/refs/tags/118.0.5993.70:v8/src/execution/isolate.cc;l=1212-1220;drc=b29ad8be0d7d9798243e1c1230dc21201c6bec8e)].

```cpp
CallSiteBuilder builder(isolate, mode, limit, caller);
VisitStack(isolate, &builder);

// If --async-stack-traces are enabled and the "current microtask" is a
// PromiseReactionJobTask, we try to enrich the stack trace with async
// frames.
if (v8_flags.async_stack_traces) {
    CaptureAsyncStackTrace(isolate, &builder);
}
```

`CaptureAsyncStackTrace` function [[2]] looks up the promise chain and appends the async stack frame according to the async call type (e.g., `await`, `Promise.all`, `Promise.any`).

Below is the snippet of `CaptureAsyncStackTrace` function which handles the `Promise.all` case:

```cpp
} else if (IsBuiltinFunction(isolate, reaction->fulfill_handler(),
                                Builtin::kPromiseAllResolveElementClosure)) {
    Handle<JSFunction> function(JSFunction::cast(reaction->fulfill_handler()),
                                isolate);
    Handle<Context> context(function->context(), isolate);
    Handle<JSFunction> combinator(context->native_context()->promise_all(),
                                isolate);
    builder->AppendPromiseCombinatorFrame(function, combinator);

    // Now peak into the Promise.all() resolve element context to
    // find the promise capability that's being resolved when all
    // the concurrent promises resolve.
    int const index =
        PromiseBuiltins::kPromiseAllResolveElementCapabilitySlot;
    Handle<PromiseCapability> capability(
        PromiseCapability::cast(context->get(index)), isolate);
    if (!IsJSPromise(capability->promise())) return;
    promise = handle(JSPromise::cast(capability->promise()), isolate);
} else if (
```

While looking up the promise chain, if `reaction->fulfill_handler` is "Promise.all Resolve Element Closure" builtin function, it appends the async promise combinator frame to the error stack.
Then, it moves to the next promise by accessing `function->context->capability->promise`.

The issue is that the function assumes the "Promise.all Resolve Element Closure" function has not been executed yet.
If the "Promise.all Resolve Element Closure" function has already been executed, the context is changed from `FunctionContext` to `NativeContext`.
It leads to a type confusion between `FunctionContext` and `NativeContext` in the `CaptureAsyncStackTrace` function.

**Making the PoC:**

The strategy to trigger the vulnerability is as follows:

1. Get the "Promise.all Resolve Element Closure" function which is an intrinsic builtin function.
2. Explicitly call the "Promise.all Resolve Element Closure" function to change the context from `FunctionContext` to `NativeContext`.
3. Set the "Promise.all Resolve Element Closure" function as a fulfill handler of a promise with a new promise chain.
4. Throw an error in the promise chain and capture the async stack trace.

I used the synchronous promise resolving pattern for `Promise.all` to get the "Promise.all Resolve Element Closure" function at the JS script level.
I borrowed the pattern from the test262 test cases.

After explicitly calling the function, to trigger the vulnerability, I used the sample code in the [zero-cost async stack trace document][v8 docs] to prepare a new promise chain and set the intrinsic builtin function as a fulfill handler of one of the promises.

Finally, when the error is thrown, the async stack trace is captured with the already executed "Promise.all Resolve Element Closure" function as a fulfill handler, leading to a type confusion between `FunctionContext` and `NativeContext`.

Here is the PoC code: [poc.js](./poc.js)

## The Exploit

(The terms exploit primitive, exploit strategy, exploit technique, and exploit flow are [defined here](https://googleprojectzero.blogspot.com/2020/06/a-survey-of-recent-ios-kernel-exploits.html).)

**Exploit primitive:** *fakeobj* primitive

**Exploit strategy:**
To build *fakeobj* primitive from the type confusion bug, I used the following strategy:

1. Heap spray with JSPromise objects to match the random hash number to a valid JSPromise object pointer.
2. Use the hash value as the valid JSPromise object pointer and inject the fake async stack frame.
3. Use `Error.prepareStackTrace` with `getThis` method to retrieve the fake object.

The bug leads to a type confusion between `FunctionContext` and `NativeContext` in the `CaptureAsyncStackTrace` function.
It accesses `Context->PromiseCapability->JSPromise` to build the next async stack frame.
When the bug is triggered, it accesses `NativeContext->JSGlobalProxy->hash`.
To exploit the bug, I used the hash value as a JSPromise object pointer.

We can check the hash value has a range of (0, 0xfffff) from the following hash generating function:

```cpp
int Isolate::GenerateIdentityHash(uint32_t mask) {
  int hash;
  int attempts = 0;
  do {
    hash = random_number_generator()->NextInt() & mask;
  } while (hash == 0 && attempts++ < 30);
  return hash != 0 ? hash : 1;
}
```

```sh
pwndbg> p/x mask
$1 = 0xfffff
```

The hash value is SMI-tagged, so in the memory, it will be stored as `hash << 1`.
Hence, the value in the memory will be in the range of (0, 0xfffff << 1) with even number.

To match the random hash number to a valid JSPromise object pointer, we got 2 constraints:

1. Interpreted pointer address should be an odd number.
2. We have to spray the heap in range (0, 0xfffff << 1).

Following the constraints, I sprayed the heap with JSPromise objects with shift-left 8 bits to make the address odd, and used small for-loops to fit in the range (0, 0xfffff << 1).

Here matching the random hash number to a valid object pointer looks quite having low chance.
To increase the reliability, I used the [iframe technique](https://blog.exodusintel.com/2019/01/22/exploiting-the-magellan-bug-on-64-bit-chrome-desktop/). 
Pages from different websites are running in different processes due to site isolation in Chrome.
So, I created an iframe with different domain, and ran the exploit in the iframe to avoid the crash of the main process.

After moving to the next promise in the promise chain, the program checks the validity of the promise and tries to append the async stack frame according to the async call type.

```cpp
  while (!builder->Full()) {
    // Check that the {promise} is not settled.
    if (promise->status() != Promise::kPending) return;

    // Check that we have exactly one PromiseReaction on the {promise}.
    if (!IsPromiseReaction(promise->reactions())) return;
    Handle<PromiseReaction> reaction(
        PromiseReaction::cast(promise->reactions()), isolate);
    if (!IsSmi(reaction->next())) return;

    // Check if the {reaction} has one of the known async function or
    // async generator continuations as its fulfill handler.
    if (IsBuiltinFunction(isolate, reaction->fulfill_handler(),
                          Builtin::kAsyncFunctionAwaitResolveClosure) ||
        IsBuiltinFunction(isolate, reaction->fulfill_handler(),
                          Builtin::kAsyncGeneratorAwaitResolveClosure) ||
        IsBuiltinFunction(
            isolate, reaction->fulfill_handler(),
            Builtin::kAsyncGeneratorYieldWithAwaitResolveClosure)) {
      // Now peek into the handlers' AwaitContext to get to
      // the JSGeneratorObject for the async function.
      Handle<Context> context(
          JSFunction::cast(reaction->fulfill_handler())->context(), isolate);
      Handle<JSGeneratorObject> generator_object(
          JSGeneratorObject::cast(context->extension()), isolate);
      CHECK(generator_object->is_suspended());

      // Append async frame corresponding to the {generator_object}.
      builder->AppendAsyncFrame(generator_object);
```

We chose `kAsyncFunctionAwaitResolveClosure` case because the parameter of the `AppendAsyncFrame` function, `generator_object`, is fully controllable.

By setting appropriate fake objects such as PromiseReaction, Function, Context, JSGeneratorObject to pass the conditions, we can inject our fake async frame by calling `builder->AppendAsyncFrame(generator_object)`.
We can check the injected fake async frame from the terminal.

```sh
Error: Let's have a look...
    at bar (../../../../fake_frame.js:168:15)
    at async foo (../../../../fake_frame.js:163:9)
    at async Promise.all (index 0)
    at async Array.sloppy_func (../../../../fake_frame.js:1:1)
```

Here is the [fake_frame.js](./fake_frame.js) code.

After injecting the fake async frame, I used `Error.prepareStackTrace` with `getThis` method to get `receiver` of the error object (in this case, it's  `JSGeneratorObject`).
With the `receiver`, we can retrieve the fake object from the heap (*fakeobj* primitive).

**Exploit flow:**
I used the typical exploitation flow for V8 exploits.

1. Using the *fakeobj* primitive, I planted and retrieved the fake OOB array.
2. Using the fake OOB array, I constructed caged_read/caged_write primitives.
3. Towards the RCE, I refered to [the technique](https://github.com/google/google-ctf/tree/main/2023/quals/sandbox-v8box/solution) that shared from the Google CTF 2023.
To escape the V8 sandbox, I corrupted the BytecodeArray object to execute arbitrary bytecode.
Using Ldar/Star instructions with out-of-bounds access, we can read/write the stack.
To leak the chrome binary base address, I read a return address from the stack to leak lower 32 bits of the base address, and read a libc heap pointer to get high 16 bits of the address.
Then, I corrupted the frame pointer for stack pivoting and execute the ROP chain to achieve RCE.

Here is the full exploit code: [index.html](./index.html) and [exploit.html](./exploit.html)
It is tested on Chrome 118.0.5993.70 which was the target version of the v8CTF M118.

<!-- Reference -->

[v8 blog]: https://v8.dev/docs/stack-trace-api  
[v8 docs]: https://docs.google.com/document/d/13Sy_kBIJGP0XT34V1CV3nkWya4TwYx9L3Yv45LdGB6Q/edit#heading=h.9ss45aibqpw2  
[1]: (https://source.chromium.org/chromium/chromium/src/+/refs/tags/118.0.5993.70:v8/src/execution/isolate.cc;l=1212-1220;drc=b29ad8be0d7d9798243e1c1230dc21201c6bec8e)
[2]: https://source.chromium.org/chromium/chromium/src/+/refs/tags/118.0.5993.70:v8/src/execution/isolate.cc;drc=b29ad8be0d7d9798243e1c1230dc21201c6bec8e;l=967  

## Credits

Haein Lee of KAIST Hacking Lab
