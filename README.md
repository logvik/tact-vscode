# Tact language support for Visual Studio code

<div align="center">
  <img src="./icons/logo.png" title="Tact language vscode extension">
</div>

![Screenshot auto compilation Tact vscode extension](images/error_highlighting.gif)

[Tact](https://tact-lang.org/) is the language used in TON blockchain project to create smart contracts.
This extension provides: 

* Syntax highlighting
* Error highlighting
* Snippets
* Additional information by hover event
* Code completion for all variables, functions, global parameters and unique types for tact
* Code completion for all contracts / libraries in the current file and all referenced imports
* Formatting

# Installation
To install the Tact language support extension for Visual Studio Code, follow these steps:
```bash
git clone https://github.com/tact-lang/tact-vscode
cd vscode-tact
yarn install
code .
```
Run the extension: Press F5 to start debugging the extension. This will open a new instance of Visual Studio Code with the Tact extension enabled.

# Instructions

## Code completion

Autocomplete is generally supported across for smart contracts, structs, functions, variables, inheritance. Autocomplete should happen automatically or press Ctrl+Space or Command+Space.

![Screenshot autocomplete Tact vscode extension](images/autocomplete.gif)

## Error highlighting

Error highlighting can be enabled or disabled using user settings. Also a default delay is implemented for all the validations compilation as Tact compilation can be slow when you have many dependencies. This part uses Tact compiler to show errors and works by save event.

```
"tact.enabledAsYouTypeCompilationErrorCheck": true,
"tact.validationDelay": 1500
```

## Additional information by hover event

If hover on a variable with some Tact functions that pop up with the information about property will be shown.

![Screenshot hover event Tact vscode extension](images/hover.gif)

## Formatting

To apply the formatting you can use the right-click context menu.
![Screenshot formatting Tact vscode extension](images/formatting.gif)

## Refactor

To rename some string in the Tact code use `F2`, to use the code actions, open the right-click context menu and select "refactor". 
![Screenshot refactor Tact vscode extension](images/refactor.gif)

## Contributing / Issues / Requests

For ideas, issues, additions, modifications please raise an issue or a pull request at https://github.com/tact-lang/tact-vscode

# Requested features

- [x] Show hovers
- [x] Formatter
- [x] Auto compilation
- [x] Help with function and method signatures
- [x] Possible actions on errors or warnings
- [ ] Linter
