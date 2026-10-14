// mersenne-twister ships no types: the seeded generator Jazzicon draws from.
declare module "mersenne-twister" {
  export default class MersenneTwister {
    constructor(seed?: number);
    random(): number;
  }
}
