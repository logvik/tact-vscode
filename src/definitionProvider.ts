import * as path from 'path';
import * as vscode from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import { TextDocument } from 'vscode-languageserver-textdocument';

import { Contract } from './model/contract';
import { ContractCollection } from './model/contractsCollection';
import { Parser } from './parser/tact';
const tactparse = new Parser();
export class TactDefinitionProvider {
  private rootPath: string | undefined;

  constructor(rootPath: string | undefined) {
    this.rootPath = rootPath;
  }

  /**
   * Provide definition for cursor position in Tact codebase. It calculate offset from cursor position and find the
   * most precise statement in tactparse AST that surrounds the cursor. It then deduces the definition of the element based
   * on the statement type.
   *
   * @param {vscode.TextDocument} document
   * @param {vscode.Position} position
   * @returns {(Thenable<vscode.Location | vscode.Location[]>)}
   * @memberof TactDefinitionProvider
   */
  public provideDefinition(
    document: TextDocument,
    position: vscode.Position,
  ): Thenable<vscode.Location | vscode.Location[] | undefined> | undefined {
    const documentText = document.getText();
    const contractPath = URI.parse(document.uri).fsPath;

    const contracts = new ContractCollection();
    contracts.addContractAndResolveImports(
      contractPath,
      documentText
    );

    // this contract
    const contract = contracts.contracts[0];
    const offset = document.offsetAt(position);
    let result: any;
    try {
      result = tactparse.parse(documentText, contractPath);
    } catch(e) {
      result = tactparse.getPrevResult();
    }
    if (typeof(result) == "undefined") {
      return undefined;
    }
    const element = this.findElementByOffset(result.body, offset);
    if (element === undefined) { return undefined; }

    switch (element.type) {
      case 'ImportStatement':
        return Promise.resolve(
          vscode.Location.create(
            URI.file(this.resolveImportPath(element.from, contract)).toString(),
            vscode.Range.create(0, 0, 0, 0),
          ),
        );
      case 'ContractStatement': {
        // find definition for inheritance
        const isBlock = this.findElementByOffset(element.is, offset);
        if (isBlock !== undefined) {
          let directImport = this.findDirectImport(
            document,
            result.body,
            isBlock.name,
            'ContractStatement',
            contracts,
          );
          
          if (directImport.location === undefined) {
            directImport = this.findDirectImport(
              document,
              result.body,
              isBlock.name,
              'TraitStatement',
              contracts,
            );
          }
          return Promise.resolve(directImport.location);
        }

        // find definition in contract body recursively
        const statement = this.findElementByOffset(element.body, offset);
        if (statement !== undefined) {
          return this.provideDefinitionInStatement(
            document,
            result.body,
            statement,
            element,
            offset,
            contracts,
          );
        }
        break;
      }
      case 'TraitStatement': {
        // find definition in trait body recursively
        const statement = this.findElementByOffset(element.body, offset);
        if (statement !== undefined) {
          return this.provideDefinitionInStatement(
            document,
            result.body,
            statement,
            element,
            offset,
            contracts,
          );
        }
        break;
      }
      default:
        return undefined;
    }
  }

  /**
   * Provide definition for anything other than `import`, and `is` statements by recursively searching through
   * statement and its children.
   *
   * @private
   * @param {vscode.TextDocument} document text document, where statement belongs, used to convert position to/from offset
   * @param {Array<any>} documentStatements array of statements found in the current document
   * @param {*} statement current statement which contains the cursor offset
   * @param {*} parentStatement parent of the current statement
   * @param {number} offset cursor offset of the element we need to provide definition for
   * @param {ContractCollection} contracts collection of contracts resolved by current contract
   * @returns {(Thenable<vscode.Location | vscode.Location[]>)}
   * @memberof TactDefinitionProvider
   */
  private provideDefinitionInStatement(
    document: vscode.TextDocument,
    documentStatements: Array<any>,
    statement: any,
    parentStatement: any,
    offset: number,
    contracts: ContractCollection,
  ): Thenable<vscode.Location | vscode.Location[]> | undefined {
    switch (statement.type) {
      case 'Type':
        // handle nested type and resolve to inner type when applicable e.g. mapping(uint => Struct)
        if (statement.literal instanceof Object && statement.literal.start <= offset && offset <= statement.literal.end) {
          return this.provideDefinitionInStatement(
            document,
            documentStatements,
            statement.literal,
            statement,
            offset,
            contracts,
          );
        } else {
          return this.provideDefinitionForType(
            document,
            documentStatements,
            statement,
            contracts,
          );
        }
      case 'Identifier':
        switch (parentStatement.type) {
          case 'CallExpression': // e.g. Func(x, y)
            if (parentStatement.callee === statement) {
              // TODO: differentiate function, and struct construction
              return this.provideDefinitionForCallee(
                contracts,
                statement.name,
              );
            }
            break;
          case 'MemberExpression': // e.g. x.y x.f(y) arr[1] map['1'] arr[i] map[k]
            if (parentStatement.object === statement) {
              // NB: it is possible to have f(x).y but the object statement would not be an identifier
              // therefore we can safely assume this is a variable instead
              return this.provideDefinitionForVariable(
                contracts,
                statement.name,
              );
            } else if (parentStatement.property === statement) {
              return Promise.all([
                // TODO: differentiate better between following possible cases

                // TODO: provide field access definition, which requires us to know the type of object
                // Consider find the definition of object first and recursive upward till declarative expression for type inference

                // array or mapping access via variable i.e. arr[i] map[k]
                this.provideDefinitionForVariable(
                  contracts,
                  statement.name,
                ),
                // func call in the form of obj.func(arg)
                this.provideDefinitionForCallee(
                  contracts,
                  statement.name,
                ),
              ]).then(locationsArray => Array.prototype.concat.apply([], locationsArray));
            }
            break;
          default:
            return this.provideDefinitionForVariable(
              contracts,
              statement.name,
            );
        }
        break;
      default:
        for (const key in statement) {
          if (statement.hasOwnProperty(key)) {
            const element = statement[key];
            if (element instanceof Array) {
              // recursively drill down to collections e.g. statements, params
              const inner = this.findElementByOffset(element, offset);
              if (inner !== undefined) {
                return this.provideDefinitionInStatement(
                  document,
                  documentStatements,
                  inner,
                  statement,
                  offset,
                  contracts,
                );
              }
            } else if (element instanceof Object) {
              // recursively drill down to elements with start/end e.g. literal type
              if (
                element.hasOwnProperty('start') && element.hasOwnProperty('end') &&
                element.start <= offset && offset <= element.end
              ) {
                return this.provideDefinitionInStatement(
                  document,
                  documentStatements,
                  element,
                  statement,
                  offset,
                  contracts,
                );
              }
            }
          }
        }

        break;
    }
  }

  /**
   * Provide definition for a callee which can be a function, struct, message or contract
   *
   * e.g. f(x), Struct, Message, Contract(address)
   *
   * @private
   * @param {ContractCollection} contracts collection of contracts resolved by current contract
   * @param {string} name name of the variable
   * @returns {Promise<vscode.Location[]>}
   * @memberof TactDefinitionProvider
   */
  private provideDefinitionForCallee(
    contracts: ContractCollection,
    name: string,
  ): Promise<vscode.Location[]> {
    return this.provideDefinitionForContractMember(
      contracts,
      (element) => {
        const elements = element.body.filter((contractElement: any) =>
          contractElement.name === name && (
            contractElement.type === 'FunctionDeclaration' ||
            contractElement.type === 'StructDeclaration' ||
            contractElement.type === 'MessageDeclaration'
          ),
        );

        if (element.type === 'ContractStatement' && element.name === name) {
          elements.push(element);
        }

        return elements;
      },
    );
  }

  /**
   * Provide definition for a variable which can be contract storage variable, constant, local variable (including parameters)
   *
   * TODO: find local variable reference (locally defined, parameters and return parameters)
   * @private
   * @param {ContractCollection} contracts collection of contracts resolved by current contract
   * @param {string} name name of the variable
   * @returns {Promise<vscode.Location[]>}
   * @memberof TactDefinitionProvider
   */
  private provideDefinitionForVariable(
    contracts: ContractCollection,
    name: string,
  ): Promise<vscode.Location[]> {
    return this.provideDefinitionForContractMember(
      contracts,
      (element) =>
        element.body.filter((contractElement: any) =>
          contractElement.name === name && (contractElement.type === 'StateVariableDeclaration')
        ),
    );
  }

  /**
   * Provide definition for a contract member
   *
   * @private
   * @param {ContractCollection} contracts collection of contracts resolved by current contract
   * @param {string} extractElements extract all relevant elements from a contract or library statement
   * @returns {Promise<vscode.Location[]>}
   * @memberof TactDefinitionProvider
   */
  private provideDefinitionForContractMember(
    contracts: ContractCollection,
    extractElements: (any: any) => Array<any>,
  ): Promise<vscode.Location[]> {
    const locations: vscode.Location[] = [];
    for (const contract of contracts.contracts) {

      let result;
      try {
        result = tactparse.parse(contract.code, contract.absolutePath);
      } catch(e) {
        result = tactparse.getPrevResult();
      }
      if (typeof(result) == "undefined") {
        continue;
      }
      const elements =  Array.prototype.concat.apply([],
        result.body.map((element: any) => {
          if (element.type === 'ContractStatement') {
            if (typeof element.body !== 'undefined' && element.body !== null) {
              return extractElements(element);
            }
          }
          if (element.type === 'StructDeclaration') {
            if (typeof element.body !== 'undefined' && element.body !== null) {
              return extractElements(element);
            }
          }
          if (element.type === 'MessageDeclaration') {
            if (typeof element.body !== 'undefined' && element.body !== null) {
              return extractElements(element);
            }
          }
          return [];
        }),
      );

      const uri = URI.file(contract.absolutePath).toString();
      const document = TextDocument.create(uri, "", 0, contract.code);
      elements.forEach(contractElement =>
        locations.push(
          vscode.Location.create(
            uri,
            vscode.Range.create(
              document.positionAt(contractElement.start),
              document.positionAt(contractElement.end),
            ),
          ),
        ),
      );
    }
    return Promise.resolve(locations);
  }

  /**
   * Provide definition for a type. A type can either be simple e.g. `Struct` or scoped `MyContract.Struct`.
   * For the scoped type, we recurse with the type member as a simple type in the scoped document.
   *
   * @private
   * @param {vscode.TextDocument} document text document, where statement belongs, used to convert position to/from offset
   * @param {Array<any>} documentStatements array of statements found in the current document
   * @param {*} literal type literal object
   * @param {ContractCollection} contracts collection of contracts resolved by current contract
   * @returns {(Thenable<vscode.Location | vscode.Location[]>)}
   * @memberof TactDefinitionProvider
   */
  private provideDefinitionForType(
    document: vscode.TextDocument,
    documentStatements: Array<any>,
    literal: any,
    contracts: ContractCollection,
  ): Thenable<vscode.Location | vscode.Location[]> | undefined {
    if (literal.members.length > 0) {
      // handle scoped type by looking for scoping Contract or Library e.g. MyContract.Struct
      let literalDocument = this.findDirectImport(document, documentStatements, literal.literal, 'ContractStatement', contracts);

      if (literalDocument.location !== undefined) {
        return this.provideDefinitionForType(
          literalDocument.document,
          literalDocument.statements,
          // a fake literal that uses the inner name and set start to the contract location
          {
            literal: literal.members[0],
            members: [],
            start: literalDocument.document.offsetAt(literalDocument.location.range.start),
          },
          contracts,
        );
      }
    } else {
      const contractStatement = this.findElementByOffset(documentStatements, literal.start);
      const structLocation = this.findStatementLocationByNameType(
        document,
        contractStatement.body,
        literal.literal,
        'StructDeclaration',
      );

      if (structLocation !== undefined) {
        return Promise.resolve(structLocation);
      }

      // TODO: only search inheritance chain
      return this.provideDefinitionForContractMember(
        contracts,
        (element) => {
          if (element.name === literal.literal && (element.type === 'StructDeclaration' || element.type === 'MessageDeclaration')) {
            return element;
          }
          return element.body.filter((contractElement: any) => {
              return contractElement.name === literal.literal && (contractElement.type === 'StructDeclaration' || contractElement.type === 'MessageDeclaration');
            }
          );
        }
      );
    }
  }

  /**
   * Find the first statement by name and type in current document and its direct imports.
   *
   * This is used to find either Contract or Trait statement to define `with`, or member accessor.
   *
   * @private
   * @param {vscode.TextDocument} document document where statements belong, used to convert offset to position
   * @param {Array<any>} statements list of statements to search through
   * @param {string} name name of statement to find
   * @param {string} type type of statement to find
   * @param {ContractCollection} contracts collection of contracts resolved by current contract
   * @returns location of the statement and its document and document statements
   * @memberof TactDefinitionProvider
   */
  private findDirectImport(
    document: vscode.TextDocument,
    statements: Array<any>,
    name: string,
    type: string,
    contracts: ContractCollection,
  ) {
    // find in the current file
    let location = this.findStatementLocationByNameType(document, statements, name, type);

    // find in direct imports if not found in file
    const contract = contracts.contracts[0];
    // TODO: when importing contracts with conflict names, which one will Tact pick? first or last? or error?
    for (let i = 0; location === undefined && i < contract.imports.length; i++) {
      const importPath = this.resolveImportPath(contract.imports[i], contract);
      const importContract = contracts.contracts.find(e => e.absolutePath === importPath);
      const uri = URI.file(importContract?.absolutePath ?? "").toString();
      document = TextDocument.create(uri, "", 0, importContract?.code ?? "");
      try {
        statements = tactparse.parse(importContract?.code ?? "", importContract?.absolutePath ?? "").body;
      } catch(e) {
        statements = tactparse.getPrevResult();
      }
      if (typeof(statements) == "undefined") {
        continue;
      }
      location = this.findStatementLocationByNameType(document, statements, name, type);
    }

    return {
      document,
      location,
      statements,
    };
  }

  /**
   * Find the first statement by its name and type
   *
   * @private
   * @param {vscode.TextDocument} document document where statements belong, used to convert offset to position
   * @param {Array<any>} statements list of statements to search through
   * @param {string} name name of statement to find
   * @param {string} type type of statement to find
   * @returns {vscode.Location} the location of the found statement
   * @memberof TactDefinitionProvider
   */
  private findStatementLocationByNameType(
    document: TextDocument,
    statements: Array<any>,
    name: string,
    type: string,
  ): vscode.Location | undefined {
    const localDef = statements.find(e => e.type === type && e.name === name);
    if (localDef !== undefined) {
      return vscode.Location.create(
        document.uri,
        vscode.Range.create(document.positionAt(localDef.start), document.positionAt(localDef.end)),
      );
    }
  }

  /**
   * Find the first element that surrounds offset
   *
   * @private
   * @param {Array<any>} elements list of elements that has `start` and `end` member
   * @param {number} offset cursor offset
   * @returns {*} the first element where offset \in [start, end]
   * @memberof TactDefinitionProvider
   */
  private findElementByOffset(elements: Array<any>, offset: number): any {
    return elements.find(
      element => element.start <= offset && offset <= element.end,
    );
  }

  /**
   * Resolve import statement to absolute file path
   *
   * @private
   * @param {string} importPath import statement in *.tact contract
   * @param {Contract} contract the contract where the import statement belongs
   * @returns {string} the absolute path of the imported file
   * @memberof TactDefinitionProvider
   */
  private resolveImportPath(importPath: string, contract: Contract): string {
    if (contract.isImportLocal(importPath)) {
      return contract.formatContractPath(path.resolve(path.dirname(contract.absolutePath), importPath));
    } else {
      return importPath;
    }
  }
}
