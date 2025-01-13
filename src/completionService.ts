'use strict';
import * as glob from 'glob';
import { relative } from 'path';
import { fileURLToPath } from 'url';
import * as path from 'path';
import { CompletionItem, CompletionItemKind } from 'vscode-languageserver';
import * as vscode from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import {Contract2, DeclarationType, DocumentContract, Function, TactCodeWalker, Variable, Struct, Message} from './codeWalkerService';

export class CompletionService {

    public rootPath: string | undefined;

    constructor(rootPath: string | undefined) {
        this.rootPath = rootPath;
    }

    public getTypeString(literal: any) {
        const isArray = literal.array_parts.length > 0;
        let isMapping = false;
        const literalType = literal.literal;
        let suffixType = '';

        if (literalType.type == undefined)  {
             isMapping = literalType.type === 'MappingExpression';
             if (isMapping) {
                suffixType = '(' + this.getTypeString(literalType.from) + ' => ' + this.getTypeString(literalType.to) + ')';
            }
        }

        if (isArray) {
            suffixType = suffixType + '[]';
        }

        if (isMapping) {
            return 'map' + suffixType;
        }

        return literalType + suffixType;
    }

    public createFunctionParamsSnippet(params: any, skipFirst: boolean = false): string {
        let paramsSnippet = '';
        let counter = 0;
        if (typeof params !== 'undefined' && params !== null) {
            params.forEach((parameterElement: any) => {
               if(skipFirst && counter === 0) {
                  skipFirst = false; 
               } else {
                counter = counter + 1;
                const currentParamSnippet = '${' + counter + ':' + parameterElement.id + '}';
                    if (paramsSnippet === '') {
                        paramsSnippet = currentParamSnippet;
                    } else {
                        paramsSnippet = paramsSnippet + ', ' + currentParamSnippet;
                    }
                }
            });
        }
        return paramsSnippet;
    }

    public createParamsInfo(params: any): string {
        let paramsInfo = '';
        if (typeof params !== "undefined" && params !== null) {
            if (params.hasOwnProperty('params')) {
                params = params.params;
            }
            params.forEach((parameterElement: any) => {
                if (typeof parameterElement.literal == "undefined") {
                    return;
                }
                const typeString = this.getTypeString(parameterElement.literal);
                let currentParamInfo = '';
                if (typeof parameterElement.id !== 'undefined' && parameterElement.id !== null ) { // no name on return parameters
                    currentParamInfo = typeString + ' ' + parameterElement.id;
                } else {
                    currentParamInfo = typeString;
                }
                if (paramsInfo === '') {
                    paramsInfo = currentParamInfo;
                } else {
                    paramsInfo = paramsInfo + ', ' + currentParamInfo;
                }
            });
        }
        return paramsInfo;
    }

    public createFunctionEventCompletionItem(contractElement: any, type: string, contractName: string | undefined, skipFirstParamSnipppet: boolean = false): CompletionItem {
        const completionItem =  CompletionItem.create(contractElement.name);
        completionItem.kind = CompletionItemKind.Function;
        const paramsInfo = this.createParamsInfo(contractElement.params);
        const paramsSnippet = this.createFunctionParamsSnippet(contractElement.params, skipFirstParamSnipppet);
        let returnParamsInfo = this.createParamsInfo(contractElement.returnParams);
        if (returnParamsInfo !== '') {
            returnParamsInfo = ' returns (' + returnParamsInfo + ')';
        }
        completionItem.insertTextFormat = 2;
        completionItem.insertText = contractElement.name + '(' + paramsSnippet + ');';
        const info = '(' + type + ' in ' + contractName + ') ' + contractElement.name + '(' + paramsInfo + ')' + returnParamsInfo;
        completionItem.documentation = info;
        completionItem.detail = info;
        return completionItem;
    }

    public createParameterCompletionItem(contractElement: any, type: string, contractName: string): CompletionItem {
        const completionItem =  CompletionItem.create(contractElement.id);
        completionItem.kind = CompletionItemKind.Variable;
        const typeString = this.getTypeString(contractElement.literal);
        completionItem.detail = '(' + type + ' in ' + contractName + ') ' + typeString + ' ' + contractElement.id;
        return completionItem;
    }

    public createVariableCompletionItem(contractElement: any, type: string, contractName: string | undefined): CompletionItem {
        const completionItem =  CompletionItem.create(contractElement.name);
        completionItem.kind = CompletionItemKind.Field;
        const typeString = this.getTypeString(contractElement.literal);
        completionItem.detail = '(' + type + ' in ' + contractName + ') ' + typeString + ' ' + contractElement.name;
        return completionItem;
    }

    public createStructCompletionItem(contractElement: any, contractName: string | undefined): CompletionItem {
        const completionItem =  CompletionItem.create(contractElement.name);
        completionItem.kind = CompletionItemKind.Struct;
        completionItem.insertText = contractElement.name;
        completionItem.detail = '(Struct in ' + contractName + ') ' + contractElement.name;
        return completionItem;
    }
    
    public createMessageCompletionItem(contractElement: any, contractName: string | undefined): CompletionItem {
        const completionItem =  CompletionItem.create(contractElement.name);
        completionItem.kind = CompletionItemKind.Struct;
        completionItem.insertText = contractElement.name;
        completionItem.detail = '(Message in ' + contractName + ') ' + contractElement.name;
        return completionItem;
    }

    // type "Contract"
    public createContractCompletionItem(contractName: string | undefined, type: string): CompletionItem {
        if (contractName == undefined) {
            return CompletionItem.create("");
        }
        const completionItem =  CompletionItem.create(contractName);
        completionItem.kind = CompletionItemKind.Class;
        completionItem.insertText = contractName;
        completionItem.detail = '(' + type + ' : ' + contractName + ')';
        return completionItem;
    }

    public createTraitCompletionItem(contractName: string | undefined): CompletionItem {
        if (contractName == undefined) {
            return CompletionItem.create("");
        }
        const completionItem =  CompletionItem.create(contractName);
        completionItem.kind = CompletionItemKind.Interface;
        completionItem.insertText = contractName;
        completionItem.detail = '( Trait : ' + contractName + ')';
        return completionItem;
    }
  
    public getAllCompletionItems(
        document: TextDocument | undefined,
        position: vscode.Position ): CompletionItem[] {
        if (document == undefined) {
            return [];
        }
        let completionItems: CompletionItem[] = [];
        let triggeredByImport = false;
        let triggeredByDotStart = 0;
        try {
            var walker = new TactCodeWalker(this.rootPath);
            const offset = document.offsetAt(position);

            var documentContractSelected = walker.getAllContracts(document, position);

            const lines = document.getText().split(/\r?\n/g);
            triggeredByDotStart = this.getTriggeredByDotStart(lines, position);

            triggeredByImport = getAutocompleteVariableNameTrimmingSpaces(lines[position.line], position.character - 1) === 'import';
            if (triggeredByDotStart > 0) {
                const globalVariableContext = GetContextualAutoCompleteByGlobalVariable(lines[position.line], triggeredByDotStart);
                if (globalVariableContext.length > 0) {
                    completionItems = completionItems.concat(globalVariableContext);
                } else {
                    let autocompleteByDot = getAutocompleteTriggerByDotVariableName(lines[position.line], triggeredByDotStart - 1);
                    // if triggered by variable //done
                    // todo triggered by method (get return type) // done
                    // todo triggered by property // done
                    // todo variable // done
                    // variable / method / property is an address or other specific type functionality (balance, etc)
                    // variable / method / property type is extended by a library
                    if (autocompleteByDot.name !== '') {
                        // have we got a selected contract (assuming not type.something)
                        if (documentContractSelected.selectedContract !== undefined) {
                            let selectedContract = documentContractSelected.selectedContract;
                            //this contract
                            if (autocompleteByDot.name === 'self' && autocompleteByDot.isVariable && autocompleteByDot.parentAutocomplete === undefined) {
                                //add selected contract completion items
                                this.addContractCompletionItems(selectedContract, completionItems);
                            }  else {
                                /// the types 
                                let topParent = autocompleteByDot.getTopParent();
                                if (topParent.name === "self") {
                                    topParent = topParent.childAutocomplete;
                                }
                                this.findDotCompletionItemsForSelectedContract(topParent, completionItems, documentContractSelected, documentContractSelected.selectedContract, offset);
                            }
                        }
                    }
                }
                return completionItems;
            }

            if (triggeredByImport) {
                let files = glob.sync(path.normalize(path.join((this.rootPath?? ""), '/**/*.tact')));

                files.forEach(item => {
                    item = path.join(item);
                    let rel = relative(fileURLToPath(document.uri), item);
                    rel = rel.split('\\').join('/');
                    if (rel.startsWith('../')) {
                        rel = rel.substr(1);
                    }
                    
                    let completionItem = CompletionItem.create(rel);
                    completionItem.kind = CompletionItemKind.Reference;
                    completionItem.insertText = '"' + rel + '";';
                    completionItem.detail = '( Import : ' + rel + ')';
                    completionItems.push(completionItem);
                });
                return completionItems;
            }

            if(documentContractSelected.selectedContract !== undefined) {
                let selectedContract = documentContractSelected.selectedContract;
                this.addSelectedContractCompletionItems(selectedContract, completionItems, offset);
            }

            documentContractSelected.allContracts.forEach(x => {
                if(x.contractType === "ContractStatement") {
                    completionItems.push(this.createContractCompletionItem(x.name, "Contract"));
                }

                if(x.contractType === "TraitStatement") {
                    completionItems.push(this.createTraitCompletionItem(x.name));
                }
            })

        } catch (error: any) {
            // graceful catch
            //console.log(error.message);
        } finally {
            completionItems = completionItems.concat(GetCompletionTypes());
            completionItems = completionItems.concat(GetCompletionKeywords());
            completionItems = completionItems.concat(GeCompletionUnits());
            completionItems = completionItems.concat(GetGlobalFunctions());
            completionItems = completionItems.concat(GetGlobalVariables());
        }
        return completionItems;
    }

    private findDotCompletionItemsForSelectedContract(autocompleteByDot:AutocompleteByDot, completionItems: any[], documentContractSelected: DocumentContract, currentContract: Contract2, offset:number) {
        if (currentContract === documentContractSelected.selectedContract) {
            let selectedFunction = documentContractSelected.selectedContract.getSelectedFunction(offset);
            this.findDotCompletionItemsForContract(autocompleteByDot, completionItems, documentContractSelected.allContracts, documentContractSelected.selectedContract, selectedFunction, offset);
        } else {
            this.findDotCompletionItemsForContract(autocompleteByDot, completionItems, documentContractSelected.allContracts, documentContractSelected.selectedContract);
        }
    }

    private findDotCompletionItemsForContract(autocompleteByDot:AutocompleteByDot, completionItems: any[], allContracts: Contract2[], currentContract: Contract2 | undefined, selectedFunction?: Function | undefined, offset?:number | undefined) {        
        if (currentContract == undefined) {
            return;
        }
        
        let allStructs: Struct[] = currentContract.getAllStructs();
        let allMessages: Message[] = currentContract.getAllMessages();
        let allVariables: Variable[] = currentContract.getAllStateVariables();
        let allfunctions: Function[] = currentContract.getAllFunctions();

        if (selectedFunction !== undefined)  {
            selectedFunction.findVariableDeclarationsInScope(offset);
            //adding input parameters
            allVariables = allVariables.concat(selectedFunction.input);
            //adding all variables
            allVariables = allVariables.concat(selectedFunction.variablesInScope);
        }
        
        let found = false;
        if (autocompleteByDot.isVariable) {
            allVariables.forEach(item => {
                if (item.name === autocompleteByDot.name && !found) {
                    found = true;
                    if(autocompleteByDot.childAutocomplete !== undefined) {
                        this.findDotType(allStructs, allMessages, item.type, autocompleteByDot.childAutocomplete, completionItems, allContracts, currentContract);
                    } else {
                        this.findDotTypeCompletion(allStructs, allMessages, item.type, completionItems, allContracts, currentContract);
                    }
                }
            });
            if (!found && (autocompleteByDot.childAutocomplete === undefined) ) {
                allContracts.forEach(item => {
                    if (item.name === autocompleteByDot.name) {
                        found = true;
                        this.addContractCompletionItems(item, completionItems);
                    }
                });
            }
        }

        if (autocompleteByDot.isMethod) {
            let items: CompletionItem[] = [];
            switch (CascadeAssociativeArray[autocompleteByDot.name]) {
                case "Slice":
                    items = getSliceCompletionItems();
                    break;
                case "Cell":
                    items = getCellCompletionItems();
                    break;
                case "Builder":
                    items = getBuilderCompletionItems();
                    break;
                case "String":
                    items = getStringCompletionItems();
                    break;
                case "Context":
                    items = getContextCompletionItems();
                    break;
                case "StdAddress":
                    items = getStdAddressCompletionItems();
                    break;
                case "VarAddress":
                    items = getVarAddressCompletionItems();
                    break;
                case "SendParameters":
                    items = getSendParametersCompletionItems();
                    break;
                case "Int":
                    items = getIntCompletionItems();
                    break;
                case "StringBuilder":
                    items = getStringBuilderCompletionItems();
                    break;
                case "Address":
                    items = getAddressCompletionItems();
                    break;
            }

            if (items.length > 0) {
                for (let i in items) {
                    completionItems.push(items[i]);
                }
            } else {
                allfunctions.forEach(item => {
                    if (item.name === autocompleteByDot.name) {
                        found = true;
                        if (item.output.length === 1) {
                            //todo return array
                            let type = item.output[0].type;
                            if(autocompleteByDot.childAutocomplete !== undefined) {
                                this.findDotType(allStructs, allMessages, type, autocompleteByDot.childAutocomplete, completionItems, allContracts, currentContract);
                            } else {
                                this.findDotTypeCompletion(allStructs, allMessages, type, completionItems, allContracts, currentContract);
                            }
                        }
                    }
                });
            }
        }
    }

    private findDotTypeCompletion(allStructs: Struct[], allMessages: Message[], type: DeclarationType | undefined, completionItems: any[], allContracts: Contract2[], currentContract: Contract2) {
        let foundStruct = allStructs.find(x => x.name === type?.name);
        let foundMessage = allMessages.find(x => x.name === type?.name);
        if (foundStruct !== undefined) {
            foundStruct.variables.forEach(property => {
                if (property.name == undefined) return;
                //own method refactor
                let completitionItem = CompletionItem.create(property.name);
                const typeString = this.getTypeString(property.element.literal);
                completitionItem.detail = '(' + property.name + ' in ' + foundStruct?.name + ') '
                    + typeString + ' ' + foundStruct?.name;
                completionItems.push(completitionItem);
            });
        } else if (foundMessage !== undefined) {
            foundMessage.variables.forEach(property => {
                if (property.name == undefined) return;
                //own method refactor
                let completitionItem = CompletionItem.create(property.name);
                const typeString = this.getTypeString(property.element.literal);
                completitionItem.detail = '(' + property.name + ' in ' + foundMessage?.name + ') '
                    + typeString + ' ' + foundMessage?.name;
                completionItems.push(completitionItem);
            });
        } else {
            let foundContract = allContracts.find(x => x.name === type?.name);
            if (foundContract !== undefined) {
                foundContract.initializeExtendContracts(allContracts);
                this.addContractCompletionItems(foundContract, completionItems);
            }
        }

        if (type?.name == 'map') {
            const items = getMapCompletionItems();
            for (let i in items) {
                completionItems.push(items[i]);
            }
        }

        if (type?.name == 'Builder') {
            const items = getBuilderCompletionItems();
            for (let i in items) {
                completionItems.push(items[i]);
            }
        }

        if (type?.name == 'Cell') {
            const items = getCellCompletionItems();
            for (let i in items) {
                completionItems.push(items[i]);
            }
        }

        if (type?.name == 'StringBuilder') {
            const items = getStringBuilderCompletionItems();
            for (let i in items) {
                completionItems.push(items[i]);
            }
        }
        
        if (type?.name == 'Int') {
            const items = getIntCompletionItems();
            for (let i in items) {
                completionItems.push(items[i]);
            }
        }

        if (type?.name == 'String') {
            const items = getStringCompletionItems();
            for (let i in items) {
                completionItems.push(items[i]);
            }
        }

        if (type?.name == 'Slice') {
            const items = getSliceCompletionItems();
            for (let i in items) {
                completionItems.push(items[i]);
            }
        }

        if (type?.name == 'Context') {
            const items = getContextCompletionItems();
            for (let i in items) {
                completionItems.push(items[i]);
            }
        }

        if (type?.name == 'StdAddress') {
            const items = getStdAddressCompletionItems();
            for (let i in items) {
                completionItems.push(items[i]);
            }
        }

        if (type?.name == 'StdAddress') {
            const items = getStdAddressCompletionItems();
            for (let i in items) {
                completionItems.push(items[i]);
            }
        }

        if (type?.name == 'SendParameters') {
            const items = getSendParametersCompletionItems();
            for (let i in items) {
                completionItems.push(items[i]);
            }
        }

        if (type?.name == 'Address') {
            const items = getAddressCompletionItems();
            for (let i in items) {
                completionItems.push(items[i]);
            }
        }

        if (foundStruct !== undefined) {
            const items = getStructCompletionItems();
            for (let i in items) {
                completionItems.push(items[i]);
            }
        }

    }

    private findDotType(allStructs: Struct[], allMessages: Message[], type: DeclarationType | undefined, autocompleteByDot: AutocompleteByDot, completionItems: any[], allContracts: Contract2[], currentContract: Contract2) {
        let foundStruct = allStructs.find(x => x.name === type?.name);
        let foundMessage = allMessages.find(x => x.name === type?.name);
        if (foundStruct !== undefined) {
            foundStruct.variables.forEach(property => {
                //own method refactor
                if(autocompleteByDot.name === property.name) {
                    if(autocompleteByDot.childAutocomplete !== undefined)  {
                        this.findDotType(allStructs, allMessages, property.type, autocompleteByDot.childAutocomplete, completionItems, allContracts, currentContract);
                    } else {
                        this.findDotTypeCompletion(allStructs, allMessages, property.type, completionItems, allContracts, currentContract);
                    }
                }
            });
        } else if (type?.name == "Builder") {
            this.findDotTypeCompletion(allStructs, allMessages, type, completionItems, allContracts, currentContract);
        } else if (foundMessage !== undefined) {
            foundMessage.variables.forEach(property => {
                //own method refactor
                if(autocompleteByDot.name === property.name) {
                    if(autocompleteByDot.childAutocomplete !== undefined)  {
                        this.findDotType(allStructs, allMessages, property.type, autocompleteByDot.childAutocomplete, completionItems, allContracts, currentContract);
                    } else {
                        this.findDotTypeCompletion(allStructs, allMessages, property.type, completionItems, allContracts, currentContract);
                    }
                }
            });
        } else {
            let foundContract = allContracts.find(x => x.name === type?.name);
            if (foundContract !== undefined) {
                foundContract.initializeExtendContracts(allContracts);
                this.findDotCompletionItemsForContract(autocompleteByDot, completionItems, allContracts, foundContract);
            }
        }
    }


    private addContractCompletionItems(selectedContract: Contract2, completionItems: any[]) {
        this.addAllFunctionsAsCompletionItems(selectedContract, completionItems);

        this.addAllStateVariablesAsCompletionItems(selectedContract, completionItems);
    }

    private addSelectedContractCompletionItems(selectedContract: Contract2, completionItems: any[], offset: number) {
        this.addAllFunctionsAsCompletionItems(selectedContract, completionItems);

        this.addAllStateVariablesAsCompletionItems(selectedContract, completionItems);

        this.addAllStructsAsCompletionItems(selectedContract, completionItems);

        this.addAllMessagesAsCompletionItems(selectedContract, completionItems);

        let selectedFunction = selectedContract.getSelectedFunction(offset);

        if (selectedFunction !== undefined) {
            selectedFunction.findVariableDeclarationsInScope(offset);
            selectedFunction.input.forEach(parameter => {
                completionItems.push(this.createParameterCompletionItem(parameter.element, "function parameter", selectedFunction?.contract?.name ?? ""));
            });

            selectedFunction.output.forEach(parameter => {
                completionItems.push(this.createParameterCompletionItem(parameter.element, "return parameter", selectedFunction?.contract?.name  ?? ""));
            });

            selectedFunction.variablesInScope.forEach(variable => {
                completionItems.push(this.createVariableCompletionItem(variable.element, "function variable", selectedFunction?.contract?.name  ?? ""));
            });
        }
    }

    private addAllStructsAsCompletionItems(documentContractSelected: Contract2, completionItems: any[]) {
        let allStructs = documentContractSelected.getAllStructs();
        allStructs.forEach(item => {
            completionItems.push(
                this.createStructCompletionItem(item.element, item.contract?.name));
        });
    }

    private addAllMessagesAsCompletionItems(documentContractSelected: Contract2, completionItems: any[]) {
        let allMessages = documentContractSelected.getAllMessages();
        allMessages.forEach(item => {
            completionItems.push(
                this.createMessageCompletionItem(item.element, item.contract?.name));
        });
    }

    private addAllStateVariablesAsCompletionItems(documentContractSelected: Contract2, completionItems: any[]) {
        let allStateVariables = documentContractSelected.getAllStateVariables();
        allStateVariables.forEach(item => {
            completionItems.push(
                this.createVariableCompletionItem(item.element, 'state variable', item.contract?.name));
        });
    }

    private addAllFunctionsAsCompletionItems(documentContractSelected: Contract2, completionItems: any[]) {
        let allfunctions = documentContractSelected.getAllFunctions();
        allfunctions.forEach(item => {
            completionItems.push(
                this.createFunctionEventCompletionItem(item.element, 'function', item.contract?.name));
        });
    }

    public getTriggeredByDotStart(lines:string[], position: vscode.Position):number {
        let start = 0;
        for (let i = position.character; i >= 0; i--) {
            if (lines[position.line][i] === ' ') {
                i = 0;
                start = 0;
            }
            if (lines[position.line][i] === '.') {
                start = i;
                i = 0;
            }
        }
        return start;
    }
}

export function GetCompletionTypes(): CompletionItem[] {
    const completionItems: CompletionItem[] = [];
    const types = ["Context", "StdAddress", "VarAddress", "SendParameters", "Int", "Bool", "Builder", "Slice", "Cell", "Address", "String", "StringBuilder", "StateInit"];
    types.forEach(type => {
        const completionItem =  CompletionItem.create(type);
        completionItem.kind = CompletionItemKind.Keyword;
        completionItem.detail = type + ' type';
        completionItems.push(completionItem);
    });
    // add mapping
    return completionItems;
}

function CreateCompletionItem(label: string, kind: CompletionItemKind, detail: string) {
    const completionItem = CompletionItem.create(label);
    completionItem.kind = kind;
    completionItem.detail = detail;
    return completionItem;
}

export function GetCompletionKeywords(): CompletionItem[] {
    const completionItems = [];
    const keywords = [ "as", "asm", "break", "continue", "initOf",
        "init", "receive", "bounced", "delete", "do", "else", "error", "false", "repeat", "from", 
        "fun", "get", "if", "try", "catch", "with", "import", "trait", "message", "map", "new", 
        "null", "return", "struct", "super", "self", "throw", "true", "while"];
    keywords.forEach(unit => {
        const completionItem =  CompletionItem.create(unit);
        completionItem.kind = CompletionItemKind.Keyword;
        completionItems.push(completionItem);
    });

    completionItems.push(CreateCompletionItem('contract', CompletionItemKind.Class, ""));
    completionItems.push(CreateCompletionItem('let', CompletionItemKind.Field, ""));
    completionItems.push(CreateCompletionItem('const', CompletionItemKind.Constant, ""));
    completionItems.push(CreateCompletionItem('init', CompletionItemKind.Constructor, ""));
    completionItems.push(CreateCompletionItem('import', CompletionItemKind.Module, ""));
    completionItems.push(CreateCompletionItem('struct', CompletionItemKind.Struct, ""));
    completionItems.push(CreateCompletionItem('message', CompletionItemKind.Struct, ""));
    completionItems.push(CreateCompletionItem('fun', CompletionItemKind.Function, ""));

    return completionItems;
}


export function GeCompletionUnits(): CompletionItem[] {
    const completionItems: CompletionItem[] = [];
    const tonUnits = ['ton'];
    tonUnits.forEach(unit => {
        const completionItem =  CompletionItem.create(unit);
        completionItem.kind = CompletionItemKind.Unit;
        completionItem.detail = unit + ': ton unit';
        completionItems.push(completionItem);
    });

    const timeUnits = ['now'];
    timeUnits.forEach(unit => {
        const completionItem =  CompletionItem.create(unit);
        completionItem.kind = CompletionItemKind.Unit;
        completionItem.detail = unit + ': time unit';
        completionItems.push(completionItem);
    });

    return completionItems;
}

export function GetGlobalVariables(): CompletionItem[] {
    return [
        {
            detail: 'Int 128',
            kind: CompletionItemKind.Variable,
            label: 'SendRemainingBalance',
        },
        {
            detail: 'Int 64',
            kind: CompletionItemKind.Variable,
            label: 'SendRemainingValue',
        },
        {
            detail: 'Int 2',
            kind: CompletionItemKind.Variable,
            label: 'SendIgnoreErrors',
        },
        {
            detail: 'Int 1',
            kind: CompletionItemKind.Variable,
            label: 'SendPayGasSeparately',
        },
        {
            detail: 'Int 32',
            kind: CompletionItemKind.Variable,
            label: 'SendDestroyIfZero',
        },
        {
            detail: 'Int 16',
            kind: CompletionItemKind.Variable,
            label: 'SendBounceIfActionFail',
        },
        {
            detail: 'Int 1024',
            kind: CompletionItemKind.Variable,
            label: 'SendOnlyEstimateFee',
        },
        {
            detail: 'Int 0',
            kind: CompletionItemKind.Variable,
            label: 'ReserveExact',
        },
        {
            detail: 'Int 1',
            kind: CompletionItemKind.Variable,
            label: 'ReserveAllExcept',
        },
        {
            detail: 'Int 2',
            kind: CompletionItemKind.Variable,
            label: 'ReserveAtMost',
        },
        {
            detail: 'Int 4',
            kind: CompletionItemKind.Variable,
            label: 'ReserveAddOriginalBalance',
        },
        {
            detail: 'Int 8',
            kind: CompletionItemKind.Variable,
            label: 'ReserveInvertSign',
        },
        {
            detail: 'Int 16',
            kind: CompletionItemKind.Variable,
            label: 'ReserveBounceIfActionFail',
        },
    ];
}

export function GetGlobalFunctions(): CompletionItem[] {
    return [
        {
            detail: 'Get Context.',
            insertText: 'context()',
            insertTextFormat: 2,
            kind: CompletionItemKind.Function,
            label: 'context',
        },
        {
            detail: 'Queue a message to be sent.',
            insertText: 'send(SendParameters{to: ${1:address}, value: ${2:0}})',
            insertTextFormat: 2,
            kind: CompletionItemKind.Function,
            label: 'send',
        },
        {
            detail: 'Queue a message Cell to be sent.',
            insertText: 'nativeSendMessage(${1:cell}, ${2:mode})',
            insertTextFormat: 2,
            kind: CompletionItemKind.Function,
            label: 'nativeSendMessage',
        },
        {
            detail: 'Queue a message Cell to be sent and get forward fees.',
            insertText: 'nativeSendMessageReturnForwardFee(${1:cell}, ${2:mode})',
            insertTextFormat: 2,
            kind: CompletionItemKind.Function,
            label: 'nativeSendMessageReturnForwardFee',
        },
        {
            detail: 'Parse StdAddress from a Slice.',
            insertText: 'parseStdAddress(${1:slice})',
            insertTextFormat: 2,
            kind: CompletionItemKind.Function,
            label: 'parseStdAddress',
        },
        {
            detail: 'Parse VarAddress from a Slice.',
            insertText: 'parseVarAddress(${1:slice})',
            insertTextFormat: 2,
            kind: CompletionItemKind.Function,
            label: 'parseVarAddress',
        },
        {
            detail: 'Convert Base64 BoC to Cell.',
            insertText: 'cell()',
            insertTextFormat: 2,
            kind: CompletionItemKind.Function,
            label: 'cell',
        },
        {
            detail: 'Convert Base64 BoC to Slice at compile-time.',
            insertText: 'slice()',
            insertTextFormat: 2,
            kind: CompletionItemKind.Function,
            label: 'slice',
        },
        {
            detail: 'String to Slice at compile-time.',
            insertText: 'rawSlice()',
            insertTextFormat: 2,
            kind: CompletionItemKind.Function,
            label: 'rawSlice',
        },
        {
            detail: 'Int sum of ASCII values at compile-time.',
            insertText: 'ascii()',
            insertTextFormat: 2,
            kind: CompletionItemKind.Function,
            label: 'ascii',
        },
        {
            detail: 'CRC32 of a String at compile-time.',
            insertText: 'crc32()',
            insertTextFormat: 2,
            kind: CompletionItemKind.Function,
            label: 'crc32',
        },
        {
            detail: 'Get config parameters.',
            insertText: 'getConfigParam(${1:Id})',
            insertTextFormat: 2,
            kind: CompletionItemKind.Function,
            label: 'getConfigParam',
        },
        {
            detail: 'Check signature.',
            insertText: 'checkSignature(${1:hash}, ${2:signature}, ${3:public_key})',
            insertTextFormat: 2,
            kind: CompletionItemKind.Function,
            label: 'checkSignature',
        },
        {
            detail: 'Check data signature.',
            insertText: 'checkDataSignature(${1:hash}, ${2:signature}, ${3:public_key})',
            insertTextFormat: 2,
            kind: CompletionItemKind.Function,
            label: 'checkDataSignature',
        },
        {
            detail: 'Native throw.',
            insertText: 'nativeThrow(${1:Int})',
            insertTextFormat: 2,
            kind: CompletionItemKind.Function,
            label: 'nativeThrow',
        },
        {
            detail: 'Native throw if.',
            insertText: 'nativeThrowIf(${1:code}, ${2:condition})',
            insertTextFormat: 2,
            kind: CompletionItemKind.Function,
            label: 'nativeThrowIf',
        },
        {
            detail: 'Throw.',
            insertText: 'throw(${1:Int})',
            insertTextFormat: 2,
            kind: CompletionItemKind.Function,
            label: 'throw',
        },
        {
            detail: 'Native throw unless.',
            insertText: 'nativeThrowUnless(${1:code}, ${2:condition})',
            insertTextFormat: 2,
            kind: CompletionItemKind.Function,
            label: 'nativeThrowUnless',
        },
        {
            detail: 'Native reserve.',
            insertText: 'nativeReserve(${1:amount}, ${2:mode})',
            insertTextFormat: 2,
            kind: CompletionItemKind.Function,
            label: 'nativeReserve',
        },
        {
            detail: 'Empty Cell.',
            insertText: 'emptyCell()',
            insertTextFormat: 2,
            kind: CompletionItemKind.Function,
            label: 'emptyCell',
        },
        {
            detail: 'Empty Slice.',
            insertText: 'emptySlice()',
            insertTextFormat: 2,
            kind: CompletionItemKind.Function,
            label: 'emptySlice',
        },
        {
            detail: 'Empty Map.',
            insertText: 'emptyMap()',
            insertTextFormat: 2,
            kind: CompletionItemKind.Function,
            label: 'emptyMap',
        },
        {
            detail: 'Begin cell and return Builder.',
            kind: CompletionItemKind.Property,
            insertText: "beginCell()",
            insertTextFormat: 2,
            label: 'beginCell',
        },
        {
            detail: 'Begin String.',
            kind: CompletionItemKind.Property,
            insertText: "beginString()",
            insertTextFormat: 2,
            label: 'beginString',
        },
        {
            detail: 'Begin Comment.',
            kind: CompletionItemKind.Property,
            insertText: "beginComment()",
            insertTextFormat: 2,
            label: 'beginComment',
        },
        {
            detail: 'Begin tail String.',
            kind: CompletionItemKind.Property,
            insertText: "beginTailString()",
            insertTextFormat: 2,
            label: 'beginTailString',
        },
        {
            detail: 'Read forward fee',
            kind: CompletionItemKind.Property,
            label: 'readForwardFee()',
        },
        {
            detail: 'Contract address ext',
            kind: CompletionItemKind.Property,
            label: 'contractAddressExt(${1:chain}, ${2:code}, ${2:data})',
        },
        {
            detail: 'Calculate a new contract address',
            kind: CompletionItemKind.Property,
            label: 'contractAddress(${1:initstate})',
        },
        {
            detail: 'Calculate a new address',
            kind: CompletionItemKind.Property,
            label: 'newAddress(${1:chain}, ${1:hash})',
        },
        {
            detail: 'My address',
            kind: CompletionItemKind.Property,
            label: 'myAddress()',
        },
        {
            detail: 'My balance',
            kind: CompletionItemKind.Property,
            label: 'myBalance()',
        },
        {
            detail: 'Reply function',
            kind: CompletionItemKind.Property,
            label: 'reply()',
        },
        {
            detail: 'Emit function',
            kind: CompletionItemKind.Property,
            label: 'emit()',
        },
        {
            detail: 'Gas consumed so far.',
            kind: CompletionItemKind.Property,
            label: "gasConsumed()",
        },
        {
            detail: 'Compute cost in nanotons.',
            kind: CompletionItemKind.Property,
            insertText: "getComputeFee(${1:gas_used_Int, ${2:is_masterchain_Bool})",
            insertTextFormat: 2,
            label: 'getComputeFee',
        },
        {
            detail: 'Storage fees in nanotons.',
            kind: CompletionItemKind.Property,
            insertText: "getStorageFee(${1:cells_Int, ${2:bits_Int}, ${3:seconds_Int}, ${4:is_masterchain_Bool})",
            insertTextFormat: 2,
            label: 'getStorageFee',
        },
        {
            detail: 'Forward fees in nanotons.',
            kind: CompletionItemKind.Property,
            insertText: "getForwardFee(${1:cells_Int, ${2:bits_Int}, ${3:is_masterchain_Bool})",
            insertTextFormat: 2,
            label: 'getForwardFee',
        },
        {
            detail: 'Extra compute cost in nanotons.',
            kind: CompletionItemKind.Property,
            insertText: "getSimpleComputeFee(${1:gas_used_Int, ${2:is_masterchain_Bool})",
            insertTextFormat: 2,
            label: 'getSimpleComputeFee',
        },
        {
            detail: 'Extra forward fees in nanotons.',
            kind: CompletionItemKind.Property,
            insertText: "getSimpleForwardFee(${1:cells_Int, ${2:bits_Int}, ${3:is_masterchain_Bool})",
            insertTextFormat: 2,
            label: 'getSimpleForwardFee',
        },
        {
            detail: 'Original fwd_fee in nanotons.',
            kind: CompletionItemKind.Property,
            insertText: "getOriginalFwdFee(${1:fwd_fee_Int, ${2:is_masterchain_Bool})",
            insertTextFormat: 2,
            label: 'getOriginalFwdFee',
        },
        {
            detail: 'Storage fee debt in nanotons.',
            kind: CompletionItemKind.Property,
            insertText: "myStorageDue(${1:fwd_fee_Int, ${2:is_masterchain_Bool})",
            insertTextFormat: 2,
            label: 'myStorageDue',
        },
    ];
}

export function GetContextualAutoCompleteByGlobalVariable(lineText: string, wordEndPosition: number): CompletionItem[] {
    if (isAutocompleteTrigeredByVariableName('math', lineText, wordEndPosition)) {
        return getMathCompletionItems();
    }
    if (isAutocompleteTrigeredByVariableName('context', lineText, wordEndPosition)) {
        return getContextCompletionItems();
    }
    return [];
}

function isAutocompleteTrigeredByVariableName(variableName: string, lineText: string, wordEndPosition: number): Boolean {
    const nameLength = variableName.length;
    if (wordEndPosition >= nameLength
        // does it equal our name?
        && lineText.substr(wordEndPosition - nameLength, nameLength) === variableName) {
          return true;
        }
    return false;
}

let CascadeAssociativeArray: {[propKey: string]: string} = {
    "contractAddress": "Address",
    "contractAddressExt": "Address",
    "send": "Int",
    "nativeSendMessageReturnForwardFee": "Int",
    "cell": "Cell",
    "slice": "Slice",
    "rawSlice": "Slice",
    "ascii": "Int",
    "crc32": "Int",
    "context": "Context",
    "parseStdAddress": "StdAddress",
    "parseVarAddress": "VarAddress",
    "gasConsumed": "Int",
    "getComputeFee": "Int",
    "getStorageFee": "Int",
    "getForwardFee": "Int",
    "getSimpleComputeFee": "Int",
    "getSimpleForwardFee": "Int",
    "getOriginalFwdFee": "Int",
    "myStorageDue": "Int",
    "beginString": "StringBuilder",
    "beginComment": "StringBuilder",
    "beginTailString": "StringBuilder",
    "beginStringFromBuilder": "StringBuilder",
    "beginParse": "Slice",
    "toString": "String",
    "toCell": "Cell",
    "toSlice": "Slice",
    "toFloatString": "String",
    "toCoinsString": "String",
    "asComment": "Cell",
    "asSlice": "Slice",
    "asString": "String",
    "asCell": "Cell",
    "fromBase64": "Slice",
    "beginCell": "Builder",
    "endCell": "Cell",
    "storeUint": "Builder",
    "storeInt": "Builder",
    "storeBit": "Builder",
    "storeBuilder": "Builder",
    "storeBool": "Builder",
    "storeSlice": "Builder",
    "storeCoins": "Builder",
    "storeAddress": "Builder",
    "storeRef": "Builder",
    "storeMaybeRef": "Builder",
    "refs": "Int",
    "bits": "Int",
    "hash": "Int",
    "loadAddress": "Address",
    "loadInt": "Int",
    "loadBit": "Bool",
    "loadBool": "Bool",
    "loadBits": "Slice",
    "loadUint": "Int",
    "loadCoins": "Int",
    "loadRef": "Cell",
    "preloadInt": "Int",
    "preloadUint": "Int",
    "preloadBits": "Slice",
    "emptyCell": "Cell",
    "readForwardFee": "Int"
}

export class AutocompleteByDot {
    public isVariable: boolean = false;
    public isMethod: boolean = false;
    public isArray: boolean = false;
    public isProperty: boolean = false;
    public parentAutocomplete: AutocompleteByDot;// could be a property or a method
    public childAutocomplete: AutocompleteByDot;
    public name: string = '';

    getTopParent(): AutocompleteByDot {
        if (this.parentAutocomplete != undefined && 
            !Object.keys(CascadeAssociativeArray).includes(this.name)
            ) {
            return this.parentAutocomplete.getTopParent();
        }
        return this;
    }
}

function getAutocompleteTriggerByDotVariableName(lineText: string, wordEndPosition:number): AutocompleteByDot {
    let searching = true;
    let result: AutocompleteByDot = new AutocompleteByDot();
    //simpler way might be to find the first space or beginning of line
    //and from there split / match
    wordEndPosition = getArrayStart(lineText, wordEndPosition, result);

    if (lineText[wordEndPosition] == ')' ) {
        result.isMethod = true;
        let methodParamBeginFound = false;
        while (!methodParamBeginFound && wordEndPosition >= 0 ) {
            if (lineText[wordEndPosition] === '(') {
                methodParamBeginFound = true;
            }
            wordEndPosition = wordEndPosition - 1;
        }
    }

    if (!result.isMethod && !result.isArray) {
        result.isVariable = true;
    }

    while (searching && wordEndPosition >= 0) {
        let currentChar = lineText[wordEndPosition];
        if (isAlphaNumeric(currentChar) || currentChar === '_' || currentChar === '$') {
            result.name = currentChar + result.name;
            wordEndPosition = wordEndPosition - 1;
        } else {
            if (currentChar === ' ') { // we only want a full word for a variable / method // this cannot be parsed due incomplete statements
                searching = false;
                return result;
            } else {
                if(currentChar === '.') {
                    result.parentAutocomplete = getAutocompleteTriggerByDotVariableName(lineText, wordEndPosition - 1);
                    result.parentAutocomplete.childAutocomplete = result;
                }
            }
            searching = false;
            return result;
        }
    }

    return result;
}

function getArrayStart(lineText: string, wordEndPosition: number, result: AutocompleteByDot) {
    if (lineText[wordEndPosition] == ']') {
        result.isArray = true;
        let arrayBeginFound = false;
        while (!arrayBeginFound && wordEndPosition >= 0) {
            if (lineText[wordEndPosition] === '[') {
                arrayBeginFound = true;
            }
            wordEndPosition = wordEndPosition - 1;
        }
    }
    if(lineText[wordEndPosition] == ']') {
        wordEndPosition = getArrayStart(lineText, wordEndPosition, result);
    }
    return wordEndPosition;
}

function getAutocompleteVariableNameTrimmingSpaces(lineText: string, wordEndPosition:number): string {
    let searching = true;
    let result: string = '';
    if (lineText[wordEndPosition] === ' ' ) {
        let spaceFound = true;
        while(spaceFound && wordEndPosition >= 0 ) {
            wordEndPosition = wordEndPosition - 1;
            if(lineText[wordEndPosition] !== ' ') {
                spaceFound = false;
            }
        }
    }

    while (searching && wordEndPosition >= 0) {
        let currentChar = lineText[wordEndPosition];
        if (isAlphaNumeric(currentChar) || currentChar === '_' || currentChar === '$') {
            result = currentChar + result;
            wordEndPosition = wordEndPosition - 1;
        } else {
            if(currentChar === ' ') { // we only want a full word for a variable // this cannot be parsed due incomplete statements
                searching = false;
                return result;
            }
            searching = false;
            return '';
        }
    }
    return result;
}

function isAlphaNumeric(str: string) {
    var code, i, len;
  
    for (i = 0, len = str.length; i < len; i++) {
      code = str.charCodeAt(i);
      if (!(code > 47 && code < 58) && // numeric (0-9)
          !(code > 64 && code < 91) && // upper alpha (A-Z)
          !(code > 96 && code < 123)) { // lower alpha (a-z)
        return false;
      }
    }
    return true;
};

function getMathCompletionItems(): CompletionItem[] {
    return [
        {
            detail: 'Returns the absolute value of the passed arguments',
            insertText: 'abs(${1:Int})',
            insertTextFormat: 2,
            kind: CompletionItemKind.Property,
            label: 'abs',
        },
        {
            detail: 'Returns the maximal value of the passed arguments',
            insertText: 'max(${1:Int}, ${2:Int})',
            insertTextFormat: 2,
            kind: CompletionItemKind.Property,
            label: 'max',
        },
        {
            detail: 'Returns the minimal value of the passed arguments',
            insertText: 'min(${1:Int}, ${2:Int})',
            insertTextFormat: 2,
            kind: CompletionItemKind.Property,
            label: 'min',
        },
        {
            detail: 'Returns random value between minimal and maximal values of the passed arguments',
            insertText: 'random(${1:Int}, ${2:Int})',
            insertTextFormat: 2,
            kind: CompletionItemKind.Property,
            label: 'random',
        },
        {
            detail: 'Returns random value',
            insertText: 'randomInt()',
            insertTextFormat: 2,
            kind: CompletionItemKind.Property,
            label: 'randomInt',
        },
        {
            detail: 'Native randomize',
            kind: CompletionItemKind.Property,
            insertText: 'nativeRandomize(${1:Int})',
            insertTextFormat: 2,
            label: 'nativeRandomize',
        },
        {
            detail: 'Native randomize lt',
            kind: CompletionItemKind.Property,
            insertText: 'nativeRandomizeLt()',
            insertTextFormat: 2,
            label: 'nativeRandomizeLt',
        },
        {
            detail: 'Native prepare random',
            kind: CompletionItemKind.Property,
            insertText: 'nativePrepareRandom()',
            insertTextFormat: 2,
            label: 'nativePrepareRandom',
        },
        {
            detail: 'Native random',
            kind: CompletionItemKind.Property,
            insertText: 'nativeRandom()',
            insertTextFormat: 2,
            label: 'nativeRandom',
        },
        {
            detail: 'Native random interval',
            kind: CompletionItemKind.Property,
            insertText: 'nativeRandomInterval(${1:Int})',
            insertTextFormat: 2,
            label: 'nativeRandomInterval',
        },
        {
            detail: 'Power function with base 2',
            kind: CompletionItemKind.Property,
            insertText: 'pow2(${1:Int})',
            insertTextFormat: 2,
            label: 'pow2',
        },
        {
            detail: 'Logarithm function with base 2',
            kind: CompletionItemKind.Property,
            insertText: 'log2(${1:Int})',
            insertTextFormat: 2,
            label: 'log2',
        },
        {
            detail: 'Logarithm function with base',
            kind: CompletionItemKind.Property,
            insertText: 'log(${1:Int},${2:Int})',
            insertTextFormat: 2,
            label: 'log',
        },
    ]
}

function getStdAddressCompletionItems(): CompletionItem[] {
    return [
        {
            detail: 'Int as int8',
            kind: CompletionItemKind.Property,
            label: 'workchain',
        },
        {
            detail: 'Int as uint256',
            kind: CompletionItemKind.Property,
            label: 'address',
        },
    ];
}

function getVarAddressCompletionItems(): CompletionItem[] {
    return [
        {
            detail: 'Int as int32',
            kind: CompletionItemKind.Property,
            label: 'workchain',
        },
        {
            detail: 'Slice',
            kind: CompletionItemKind.Property,
            label: 'address',
        },
    ];
}

function getSendParametersCompletionItems(): CompletionItem[] {
    return [
        {
            detail: 'Bool, defaults to true',
            kind: CompletionItemKind.Property,
            label: 'bounce',
        },
        {
            detail: 'Address',
            kind: CompletionItemKind.Property,
            label: 'to',
        },
        {
            detail: 'Int',
            kind: CompletionItemKind.Property,
            label: 'value',
        },
        {
            detail: 'Int, defaults to 0',
            kind: CompletionItemKind.Property,
            label: 'mode',
        },
        {
            detail: 'Cell?',
            kind: CompletionItemKind.Property,
            label: 'body',
        },
        {
            detail: 'Cell?',
            kind: CompletionItemKind.Property,
            label: 'code',
        },
        {
            detail: 'Cell?',
            kind: CompletionItemKind.Property,
            label: 'data',
        },
    ];
}

function getContextCompletionItems(): CompletionItem[] {
    return [
        {
            detail: 'Bool - Bounced(opens in a new tab) flag of incoming message',
            kind: CompletionItemKind.Property,
            label: 'bounced',
        },
        {
            detail: 'Address - Address of sender.',
            kind: CompletionItemKind.Property,
            label: 'sender',
        },
        {
            detail: 'Int - Amount of nanoToncoins in message.',
            kind: CompletionItemKind.Property,
            label: 'value',
        },
        {
            detail: 'Slice - Slice reminder of message',
            kind: CompletionItemKind.Property,
            label: 'raw',
        }
    ];
}

function getMapCompletionItems(): CompletionItem[] {
    return [
        {
            detail: 'Get element',
            kind: CompletionItemKind.Property,
            insertText: "get(${1:key})",
            insertTextFormat: 2,
            label: 'get',
        },
        {
            detail: 'Set element',
            kind: CompletionItemKind.Property,
            insertText: "set(${1:key}, ${2:value})",
            insertTextFormat: 2,
            label: 'set',
        },
        {
            detail: 'As cell',
            kind: CompletionItemKind.Property,
            insertText: "asCell()",
            insertTextFormat: 2,
            label: 'asCell',
        },
        {
            detail: 'Is empty',
            kind: CompletionItemKind.Property,
            insertText: "isEmpty()",
            insertTextFormat: 2,
            label: 'isEmpty',
        },
        {
            detail: 'Key exists',
            kind: CompletionItemKind.Property,
            insertText: "exists()",
            insertTextFormat: 2,
            label: 'exists',
        },
        {
            detail: 'Deep equality check',
            kind: CompletionItemKind.Property,
            insertText: "deepEquals(${1:anotherMap})",
            insertTextFormat: 2,
            label: 'deepEquals',
        },
    ]
}

function getStringBuilderCompletionItems(): CompletionItem[] {
    return [
        {
            detail: 'Begin parse this Cell. Return Slice.',
            kind: CompletionItemKind.Property,
            insertText: "beginParse()",
            insertTextFormat: 2,
            label: 'beginParse',
        },
        {
            detail: 'Append String.',
            kind: CompletionItemKind.Property,
            insertText: "append(${1:String})",
            insertTextFormat: 2,
            label: 'append',
        },
        {
            detail: 'StringBuilder to Cell.',
            kind: CompletionItemKind.Property,
            insertText: "toCell()",
            insertTextFormat: 2,
            label: 'toCell',
        },
        {
            detail: 'StringBuilder to String.',
            kind: CompletionItemKind.Property,
            insertText: "toString()",
            insertTextFormat: 2,
            label: 'toString',
        },
        {
            detail: 'StringBuilder to Slice.',
            kind: CompletionItemKind.Property,
            insertText: "toSlice()",
            insertTextFormat: 2,
            label: 'toSlice',
        },
        {
            detail: 'Concatenation of strings',
            kind: CompletionItemKind.Property,
            insertText: "concat()",
            insertTextFormat: 2,
            label: 'concat',
        },
    ];
}

function getAddressCompletionItems(): CompletionItem[] {
    return [
        {
            detail: 'Address to string.',
            kind: CompletionItemKind.Property,
            insertText: "toString()",
            insertTextFormat: 2,
            label: 'toString',
        },
    ];
}

function getStructCompletionItems(): CompletionItem[] {
    return [
        {
            detail: 'Struct from Cell.',
            kind: CompletionItemKind.Property,
            insertText: "fromCell()",
            insertTextFormat: 2,
            label: 'fromCell',
        },
        {
            detail: 'Struct from Slice.',
            kind: CompletionItemKind.Property,
            insertText: "fromSlice()",
            insertTextFormat: 2,
            label: 'fromSlice',
        },
        {
            detail: 'Struct to Cell.',
            kind: CompletionItemKind.Property,
            insertText: "toCell()",
            insertTextFormat: 2,
            label: 'toCell',
        },
        {
            detail: 'Struct to Slice.',
            kind: CompletionItemKind.Property,
            insertText: "toSlice()",
            insertTextFormat: 2,
            label: 'toSlice',
        },
    ];
}

function getIntCompletionItems(): CompletionItem[] {
    return [
        {
            detail: 'Int to String.',
            kind: CompletionItemKind.Property,
            insertText: "toString()",
            insertTextFormat: 2,
            label: 'toString',
        },
        {
            detail: 'Int to float string with digits.',
            kind: CompletionItemKind.Property,
            insertText: "toFloatString(${1:Int})",
            insertTextFormat: 2,
            label: 'toFloatString',
        },
        {
            detail: 'Int to coins string.',
            kind: CompletionItemKind.Property,
            insertText: "toCoinsString()",
            insertTextFormat: 2,
            label: 'toCoinsString',
        },
    ];
}

function getStringCompletionItems(): CompletionItem[] {
    return [
        {
            detail: 'Begin parse this Cell. Return Slice.',
            kind: CompletionItemKind.Property,
            insertText: "beginParse()",
            insertTextFormat: 2,
            label: 'beginParse',
        },
        {
            detail: 'Convert to Cell.',
            kind: CompletionItemKind.Property,
            insertText: "asComment()",
            insertTextFormat: 2,
            label: 'asComment',
        },
        {
            detail: 'Convert to Slice.',
            kind: CompletionItemKind.Property,
            insertText: "asSlice()",
            insertTextFormat: 2,
            label: 'asSlice',
        },
        {
            detail: 'Convert to Slice from base64.',
            kind: CompletionItemKind.Property,
            insertText: "fromBase64()",
            insertTextFormat: 2,
            label: 'fromBase64',
        },
    ];
}

function getCellCompletionItems(): CompletionItem[] {
    return [
        {
            detail: 'Begin parse this Cell. Return Slice.',
            kind: CompletionItemKind.Property,
            insertText: "beginParse()",
            insertTextFormat: 2,
            label: 'beginParse',
        },
        {
            detail: 'Hash for this Cell.',
            kind: CompletionItemKind.Property,
            insertText: "hash()",
            insertTextFormat: 2,
            label: 'hash',
        },
        {
            detail: 'Convert to Slice.',
            kind: CompletionItemKind.Property,
            insertText: "asSlice()",
            insertTextFormat: 2,
            label: 'asSlice',
        }
    ];
}

function getBuilderCompletionItems(): CompletionItem[] {
    return [
        {
            detail: 'Returns bits count.',
            kind: CompletionItemKind.Property,
            insertText: "bits()",
            insertTextFormat: 2,
            label: 'bits',
        },
        {
            detail: 'Returns refs count.',
            kind: CompletionItemKind.Property,
            insertText: "refs()",
            insertTextFormat: 2,
            label: 'refs',
        },
        {
            detail: 'Returns a constructed Cell',
            kind: CompletionItemKind.Property,
            insertText: "endCell()",
            insertTextFormat: 2,
            label: 'endCell',
        },
        {
            detail: 'Store Address.',
            kind: CompletionItemKind.Property,
            insertText: "storeAddress(${1:Address})",
            insertTextFormat: 2,
            label: 'storeAddress',
        },
        {
            detail: 'Store Slice.',
            kind: CompletionItemKind.Property,
            insertText: "storeSlice(${1:Slice})",
            insertTextFormat: 2,
            label: 'storeSlice',
        },
        {
            detail: 'Store ref.',
            kind: CompletionItemKind.Property,
            insertText: "storeRef(${1:Cell})",
            insertTextFormat: 2,
            label: 'storeRef',
        },
        {
            detail: 'Store ref to Cell?.',
            kind: CompletionItemKind.Property,
            insertText: "storeMaybeRef(${1:CellOrNull})",
            insertTextFormat: 2,
            label: 'storeMaybeRef',
        },
        {
            detail: 'Store coins.',
            kind: CompletionItemKind.Property,
            insertText: "storeCoins(${1:Int})",
            insertTextFormat: 2,
            label: 'storeCoins',
        },
        {
            detail: 'Store Bool.',
            kind: CompletionItemKind.Property,
            insertText: "storeBool(${1:Bool})",
            insertTextFormat: 2,
            label: 'storeBool',
        },
        {
            detail: 'Alias to .storeBool().',
            kind: CompletionItemKind.Property,
            insertText: "storeBit(${1:Bool})",
            insertTextFormat: 2,
            label: 'storeBit',
        },
        {
            detail: 'Store Builder.',
            kind: CompletionItemKind.Property,
            insertText: "storeBuilder(${1:Builder})",
            insertTextFormat: 2,
            label: 'storeBuilder',
        },
        {
            detail: 'Store UInt.',
            kind: CompletionItemKind.Property,
            insertText: "storeUint(${1:value}, ${2:bits})",
            insertTextFormat: 2,
            label: 'storeUint',
        },
        {
            detail: 'Store Int.',
            kind: CompletionItemKind.Property,
            insertText: "storeInt(${1:value}, ${2:bits})",
            insertTextFormat: 2,
            label: 'storeInt',
        },
        {
            detail: 'Convert to Slice.',
            kind: CompletionItemKind.Property,
            insertText: "asSlice()",
            insertTextFormat: 2,
            label: 'asSlice',
        },
        {
            detail: 'Convert to Cell.',
            kind: CompletionItemKind.Property,
            insertText: "asCell()",
            insertTextFormat: 2,
            label: 'asCell',
        },
        {
            detail: 'Begin string from Builder.',
            kind: CompletionItemKind.Property,
            insertText: "beginStringFromBuilder()",
            insertTextFormat: 2,
            label: 'beginStringFromBuilder',
        },
    ]
}

function getSliceCompletionItems(): CompletionItem[] {
    return [
        {
            detail: 'Load reference.',
            kind: CompletionItemKind.Property,
            insertText: "loadRef()",
            insertTextFormat: 2,
            label: 'loadRef',
        },
        {
            detail: 'End cell and return it.',
            kind: CompletionItemKind.Property,
            insertText: "endCell()",
            insertTextFormat: 2,
            label: 'endCell',
        },
        {
            detail: 'Preload reference.',
            kind: CompletionItemKind.Property,
            insertText: "preloadRef()",
            insertTextFormat: 2,
            label: 'preloadRef',
        },
        {
            detail: 'Load bits.',
            kind: CompletionItemKind.Property,
            insertText: "loadBits(${1:Int})",
            insertTextFormat: 2,
            label: 'loadBits',
        },
        {
            detail: 'Preload bits.',
            kind: CompletionItemKind.Property,
            insertText: "preloadBits(${1:Int})",
            insertTextFormat: 2,
            label: 'preloadBits',
        },
        {
            detail: 'Load Int.',
            kind: CompletionItemKind.Property,
            insertText: "loadInt(${1:Int})",
            insertTextFormat: 2,
            label: 'loadInt',
        },
        {
            detail: 'Preload Int.',
            kind: CompletionItemKind.Property,
            insertText: "preloadInt(${1:Int})",
            insertTextFormat: 2,
            label: 'preloadInt',
        },
        {
            detail: 'Load unsigned Int.',
            kind: CompletionItemKind.Property,
            insertText: "loadUint(${1:Int})",
            insertTextFormat: 2,
            label: 'loadUint',
        },
        {
            detail: 'Load Bool.',
            kind: CompletionItemKind.Property,
            insertText: "loadBool(${1:Bool})",
            insertTextFormat: 2,
            label: 'loadBool',
        },
        {
            detail: 'Alias to .loadBool().',
            kind: CompletionItemKind.Property,
            insertText: "loadBit(${1:Bool})",
            insertTextFormat: 2,
            label: 'loadBit',
        },
        {
            detail: 'Preload unsigned Int.',
            kind: CompletionItemKind.Property,
            insertText: "preloadUint(${1:Int})",
            insertTextFormat: 2,
            label: 'preloadUint',
        },
        {
            detail: 'Load coins.',
            kind: CompletionItemKind.Property,
            insertText: "loadCoins()",
            insertTextFormat: 2,
            label: 'loadCoins',
        },
        {
            detail: 'Load Address.',
            kind: CompletionItemKind.Property,
            insertText: "loadAddress()",
            insertTextFormat: 2,
            label: 'loadAddress',
        },
        {
            detail: 'Skip bits.',
            kind: CompletionItemKind.Property,
            insertText: "skipBits(${1:Int})",
            insertTextFormat: 2,
            label: 'skipBits',
        },
        {
            detail: 'End parse.',
            kind: CompletionItemKind.Property,
            insertText: "endParse()",
            insertTextFormat: 2,
            label: 'endParse',
        },
        {
            detail: 'Hash for this Slice.',
            kind: CompletionItemKind.Property,
            insertText: "hash()",
            insertTextFormat: 2,
            label: 'hash',
        },
        {
            detail: 'Count of refs.',
            kind: CompletionItemKind.Property,
            insertText: "refs()",
            insertTextFormat: 2,
            label: 'refs',
        },
        {
            detail: 'Count of bits.',
            kind: CompletionItemKind.Property,
            insertText: "bits()",
            insertTextFormat: 2,
            label: 'bits',
        },
        {
            detail: 'Empty or not.',
            kind: CompletionItemKind.Property,
            insertText: "empty()",
            insertTextFormat: 2,
            label: 'empty',
        },
        {
            detail: 'Data empty or not.',
            kind: CompletionItemKind.Property,
            insertText: "dataEmpty()",
            insertTextFormat: 2,
            label: 'dataEmpty',
        },
        {
            detail: 'Refs empty or not.',
            kind: CompletionItemKind.Property,
            insertText: "refsEmpty()",
            insertTextFormat: 2,
            label: 'refsEmpty',
        },
        {
            detail: 'Convert to Cell.',
            kind: CompletionItemKind.Property,
            insertText: "asCell()",
            insertTextFormat: 2,
            label: 'asCell',
        },
        {
            detail: 'Convert base64 Slice to Slice.',
            kind: CompletionItemKind.Property,
            insertText: "fromBase64()",
            insertTextFormat: 2,
            label: 'fromBase64',
        },
        {
            detail: 'Convert Slice to String.',
            kind: CompletionItemKind.Property,
            insertText: "asString()",
            insertTextFormat: 2,
            label: 'asString',
        },
    ]
}
