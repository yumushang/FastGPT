import React from 'react';
import { Input, type InputProps, InputGroup, InputRightElement, Flex } from '@chakra-ui/react';
import MyIcon from '../../Icon';

interface SearchInputProps extends InputProps {
  isClearable?: boolean;
}

const SearchInput = ({ isClearable = false, ...props }: SearchInputProps) => {
  const { value, onChange } = props;
  const hasValue = value !== undefined && value !== '';

  const handleClear = () => {
    if (onChange) {
      // Create a synthetic event to match the expected type
      const syntheticEvent = {
        target: { value: '' }
      } as React.ChangeEvent<HTMLInputElement>;
      onChange(syntheticEvent);
    }
  };

  return (
    <InputGroup position={'relative'} maxW={props.maxW}>
      <MyIcon
        position={'absolute'}
        zIndex={10}
        left={2.5}
        name={'common/searchLight'}
        w={4}
        top={'50%'}
        transform={'translateY(-50%)'}
        color={'myGray.600'}
      />
      <Input
        fontSize="sm"
        bg={'myGray.25'}
        pl={8}
        pr={isClearable && hasValue ? 9 : undefined}
        {...props}
      />
      {isClearable && hasValue && (
        <InputRightElement h={'100%'} w={'36px'} justifyContent={'center'} alignItems={'center'}>
          <Flex
            w={'1.25rem'}
            h={'1.25rem'}
            alignItems={'center'}
            justifyContent={'center'}
            borderRadius={'50%'}
            bg={'myGray.300'}
            cursor={'pointer'}
            _hover={{ bg: 'myGray.400' }}
            transition={'background 0.2s'}
            onClick={handleClear}
          >
            <MyIcon name={'common/closeLight'} w={'80%'} h={'80%'} color={'white'} />
          </Flex>
        </InputRightElement>
      )}
    </InputGroup>
  );
};

export default React.memo(SearchInput);
