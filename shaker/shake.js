const esprima = require('esprima');
const escodegen = require('escodegen');
const fs = require('fs');

// parser class
class Parser {
  // simply set some default values
  constructor(entryModule) {
    this.importedVals = new Map();
    this.exportedVals = [];
    this.modulesSet = [];
    this.module = entryModule;
    // bind bc no transform plugin
    this.followImportSources = this.followImportSources.bind(this);
  }
  // pull in the path and parse its content
  parseModule(relPath) {
    const codeBuffer = fs.readFileSync(__dirname + relPath);
    return esprima.parseModule(codeBuffer.toString());
  }
  // traverse the tree of module 
  // look for ImportDeclaration type
  // follow imports recursively
  extractImports(module) {
    const extractedImports = this.traverseSyntaxTree({
      AST: this.parseModule(`/modules/${module}.js`),
      extractType: 'ImportDeclaration',
      recursiveCaller: this.followImportSources,
      extractor: (node) => {
        // look for the imported key and return its name
        return node.specifiers
          .map(val => val.imported.name);
      }
    });
    // put the extracted import into our hashmap
    extractedImports
      .forEach(imp => this.importedVals.set(imp, imp.toString()))
    return this.importedVals;
  }
  // define the function to follow import sources
  // either push the module name into the Modules Map
  // or don't do anything
  followImportSources({ source }) {
    const followModule = source.value.replace('./', '');
    followModule.length
      ? (() => {
        this.extractImports(followModule);
        this.modulesSet.push({
          name: followModule,
          module: this.parseModule(`/modules/${followModule}.js`)
        });
      })()
      : undefined;
  }
  // traverse the AST and do whatever
  //extractImports function told us to do
  traverseSyntaxTree({
    AST,
    extractType,
    extractor,
    recursiveCaller = noop => noop
  }) {
    const { body } = AST;
    let extractedNodes = [];
    body.forEach(node => {
      if (extractType === node.type) {
        const extractedVals = extractor(node);
        extractedNodes = [...extractedNodes, ...extractedVals];
        recursiveCaller(node);
      }
    })
   return extractedNodes;
  }
  // either return importedVals if we had them already
  // or trigger the extractImports fn
  get Imports() {
    return this.importedVals.length
      ? this.importedVals
      : this.extractImports(this.module);
  }
}

// right beneath the Parser class
class TreeShaker {
  // store the unshaked modules
  // shake the modules when initializing 
  constructor({ Imports, modulesSet }) {
     this.unshaked = modulesSet;
     this.modules = TreeShaker.shake(modulesSet, Imports);
   }
   // do static because... well 🤷🏻‍
   static shake(modules, importedVals) {
     // get all the values from the module map defined in Parser
     // and turn them into an array
     // btw make a copy of modules otherwise
     // you won't be able to compare old vs new
     return Array.from(modules.entries())
       .map(([, { module: m, name }]) => {
         const module = { ...m };
         const { body } = module;
         const shakedBody = [];
         // traverse every body of every module
         // look for export declarations && 
         // if the exported name is in the array of imports
         // we include it in our new body
         // also we include everything else thats not an export
         body.forEach(node => {
           if (node.type === 'ExportNamedDeclaration') {
              node.declaration.declarations
                .forEach(({ id }) => {
                  if (importedVals.has(id.name)) {
                    shakedBody.push(node);
                  }
                });
            } else {
              shakedBody.push(node);
            }
         })
         module.body = shakedBody;
         return module;
     })
   }
   // make the original modules accessible
   get Unshaked () {
     return this.unshaked;
   }
   // and the optimized modules are of course accessible as well
   get Modules() {
     return this.modules;
   }
 }

// create a new instance of Parser and TreeShaker
// initalized with our entry point: module1
const shakeItBaby = new TreeShaker(new Parser('module1'));
// make it one big bundle with new modules
const moduleStringOptimized = shakeItBaby.Modules
   .map(m => escodegen.generate(m))
   .join('');
// also make one bundled version with the old modules
// note: we have to specifiy the module prop on the module object
const moduleStringUnshaked = shakeItBaby.Unshaked
   .map(u => escodegen.generate(u.module))
   .join('');
// have a look at how different they look
console.log(moduleStringOptimized);
console.log(moduleStringUnshaked);
// let's count the characters
//  do a naive comparison => in percent
const impr = Math.floor(
  (
    1 -
    moduleStringOptimized.length /
    moduleStringUnshaked.length
  ) * 100
);

console.log('IMPROVEMENT: ', impr, '% 🎉');