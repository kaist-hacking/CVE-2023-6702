var closure;

function Constructor(executor) {
  executor(()=>{}, ()=>{});
}
Constructor.resolve = function(v) {
  return v;
};

let p1 = {
  then(onFul, onRej) {
    closure = onFul;
    closure(1);
  }
};

async function foo() {
  await Promise.all.call(Constructor, [p1]);
  await bar(1);
}

async function bar(x) {
  await x;
  throw new Error("Let's have a look...");
}

foo()
  .then(closure)
  .catch(e => console.log(e.stack));
