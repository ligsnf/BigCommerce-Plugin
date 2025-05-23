import { H4, Panel, Text } from '@bigcommerce/big-design';

interface BasicInfoPanelProps {
  name: string;
}

const BasicInfoPanel = ({ name }: BasicInfoPanelProps) => {
  return (
    <Panel header="Basic Information" marginBottom="small">
      <H4>Product name</H4>
      <Text>{name}</Text>
    </Panel>
  );
};

export default BasicInfoPanel; 