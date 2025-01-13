import { doc } from 'prettier';
const { group, indent, line } = doc.builders;

const Conditional = {
  print: ({ path, print }: any) =>
    group([
      path.call(print, 'test'),
      indent([
        line,
        '? ',
        path.call(print, 'consequent'),
        line, 
        ': ',
        path.call(print, 'alternate')
      ])
    ])
};

export default Conditional;
